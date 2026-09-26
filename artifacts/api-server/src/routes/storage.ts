import { Readable } from "node:stream";
import {
  RequestProductImageUploadBody,
  RequestProductImageUploadResponse,
} from "@workspace/api-zod";
import { db, products } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAdminFromRequest } from "../lib/admin-auth";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.post(
  "/storage/product-images/upload-url",
  async (req: Request, res: Response) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return res.status(401).json({ error: "Authentication required" });
    if (admin.role !== "super_admin") {
      return res.status(403).json({ error: "Super admin access required" });
    }

    const parsed = RequestProductImageUploadBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid product image metadata" });
    }

    try {
      const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadUrl);
      if (!objectPath.startsWith("/objects/uploads/")) {
        throw new Error("Storage returned an unexpected product image path");
      }
      return res.json(
        RequestProductImageUploadResponse.parse({ uploadUrl, objectPath }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Unable to create product image upload URL");
      return res.status(500).json({ error: "Unable to create product image upload URL" });
    }
  },
);

router.get(
  "/products/:productId/image",
  async (req: Request, res: Response) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return res.status(401).json({ error: "Authentication required" });

    try {
      const productId = Array.isArray(req.params.productId)
        ? req.params.productId[0]
        : req.params.productId;
      if (!productId) return res.status(404).json({ error: "Product image not found" });
      const rows = await db
        .select({ imageUrl: products.imageUrl })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      const imagePath = rows[0]?.imageUrl;
      if (!imagePath?.startsWith("/objects/uploads/")) {
        return res.status(404).json({ error: "Product image not found" });
      }

      const file = await objectStorageService.getObjectEntityFile(imagePath);
      const response = await objectStorageService.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (!response.body) return res.end();

      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.on("error", (error) => {
        req.log.error({ err: error }, "Unable to stream product image");
        if (!res.headersSent) res.status(500);
        res.end();
      });
      return nodeStream.pipe(res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Product image not found" });
      }
      req.log.error({ err: error }, "Unable to serve product image");
      return res.status(500).json({ error: "Unable to serve product image" });
    }
  },
);

export default router;