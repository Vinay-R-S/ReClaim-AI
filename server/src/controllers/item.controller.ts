/**
 * Item HTTP layer.
 *
 * Reads the request, calls the service, shapes the response. Every decision
 * about what is allowed or what happens next belongs to `ItemService`; a
 * refusal arrives here as an `AppError` carrying its own status.
 */

import { Request, Response } from 'express';
import { ItemService, itemService } from '../services/item.service.js';
import { listAdminAuditForTarget } from '../services/audit.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type {
  ItemListQuery,
  ItemModerateBody,
  ItemStatusUpdateBody,
  ItemUpdateBody,
} from '../schemas/index.js';
import type { ItemInput } from '../types/index.js';

export class ItemController {
  constructor(private readonly items: ItemService = itemService) {}

  list = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { items, nextCursor } = await this.items.list(
      req.query as unknown as ItemListQuery,
      req.user,
    );

    return res.json({ items, nextCursor });
  };

  getById = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { id } = req.params;

    // `/user` is a sibling route, not an item id. Express matches this pattern
    // first, so it has to hand the caller back to the right path.
    if (id === 'user') {
      return res.status(400).json({ error: 'Use /api/items/user/:userId' });
    }

    const item = await this.items.getById(id, req.user);

    return res.json({ item });
  };

  listByUser = async (req: Request, res: Response): Promise<Response> => {
    const items = await this.items.listByReporter(req.params.userId);

    return res.json({ items });
  };

  create = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { item, images } = req.body as { item: ItemInput; images?: string[] };

    const created = await this.items.create(item, images, req.user!);

    return res.status(201).json({
      id: created.item.id,
      item: created.item,
      matching: created.matching,
    });
  };

  moderate = async (req: AuthRequest, res: Response): Promise<Response> => {
    const result = await this.items.moderate(
      req.params.id,
      req.body as ItemModerateBody,
      req.user!.uid,
    );

    return res.json({ success: true, ...result });
  };

  listAudit = async (req: Request, res: Response): Promise<Response> => {
    const entries = await listAdminAuditForTarget(req.params.id);

    return res.json({ entries });
  };

  rematch = async (req: Request, res: Response): Promise<Response> => {
    await this.items.rematch(req.params.id);

    return res.json({ success: true, message: 'Matching restarted' });
  };

  update = async (req: AuthRequest, res: Response): Promise<Response> => {
    const item = await this.items.update(req.params.id, req.body as ItemUpdateBody, req.user!);

    return res.json({ success: true, item });
  };

  updateStatus = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { status, matchedUserId } = req.body as ItemStatusUpdateBody;

    await this.items.updateStatus(req.params.id, status, matchedUserId);

    return res.json({ success: true });
  };

  remove = async (req: AuthRequest, res: Response): Promise<Response> => {
    await this.items.remove(req.params.id, req.user!);

    return res.json({ success: true });
  };
}

export const itemController = new ItemController();
