/**
 * Item visibility and the moderation gate, against a fake repository.
 *
 * These are the rules that decide who can see an unreviewed report and what an
 * owner may change on their own. Several are named after the defect they close.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./cloudinary.service.js', () => ({
  isCloudinaryConfigured: () => false,
  uploadMultipleImages: vi.fn(),
  deleteImage: vi.fn(),
}));

vi.mock('./autoMatch.service.js', () => ({ triggerAutoMatching: vi.fn() }));
vi.mock('./audit.service.js', () => ({
  recordAdminAction: vi.fn(),
  listAdminAuditForTarget: vi.fn(),
}));
vi.mock('./userStats.service.js', () => ({ updateUserItemCounts: vi.fn() }));

const { ItemService, isPubliclyVisible } = await import('./item.service.js');
const { AppError } = await import('../middleware/errorHandler.middleware.js');

type AuthUser = import('../middleware/auth.middleware.js').AuthUser;

type StoredItem = Record<string, unknown> & { id: string };

function caller(uid: string, role: 'user' | 'admin'): AuthUser {
  return { uid, role, status: 'active', profileExists: true };
}

const ADMIN = caller('admin-1', 'admin');
const OWNER = caller('owner-1', 'user');
const STRANGER = caller('other-1', 'user');

/** A stored item carries its date as a Firestore timestamp, not a Date. */
const REPORTED_AT = { toDate: () => new Date(2026, 0, 2, 12, 0, 0) };

function item(overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    id: 'item-1',
    name: 'Black wallet',
    description: 'A black leather wallet',
    type: 'Lost',
    status: 'Pending',
    moderation: 'approved',
    location: 'Canteen',
    date: REPORTED_AT,
    reportedBy: OWNER.uid,
    ...overrides,
  };
}

/** A repository that answers from an array, recording what it was asked. */
function fakeRepository(items: StoredItem[]) {
  return {
    items,
    updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    async findById(id: string) {
      return items.find((entry) => entry.id === id) ?? null;
    },
    async list(filters: { limit: number; moderation?: string }) {
      const filtered = filters.moderation
        ? items.filter((entry) => entry.moderation === filters.moderation)
        : items;

      return {
        items: filtered.slice(0, filters.limit),
        sortedByQuery: !filters.moderation,
        nextCursor: null,
      };
    },
    async update(id: string, data: Record<string, unknown>) {
      this.updates.push({ id, data });
    },
    async updateAndFetch(id: string, data: Record<string, unknown>) {
      this.updates.push({ id, data });

      return { ...(await this.findById(id)), ...data } as StoredItem;
    },
    async create(data: Record<string, unknown>) {
      return { ...data, id: 'created-1' } as StoredItem;
    },
    async delete() {},
    async exists() {
      return true;
    },
    async claimMatchingRun() {
      return true;
    },
    async releaseMatchingRun() {},
    async listByReporter() {
      return [];
    },
    async listAllByReporter() {
      return [];
    },
    async listByReporterAndType() {
      return [];
    },
    async listPendingByType() {
      return [];
    },
    async updateMany() {},
    async patch() {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serviceFor = (items: StoredItem[]) => {
  const repo = fakeRepository(items);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ItemService(repo as any), repo };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isPubliclyVisible', () => {
  /**
   * UI-01: an item created before moderation existed carries no field. Reading
   * that as "not approved" would empty the browse list on deploy and keep it
   * empty until the migration ran.
   */
  it('UI-01 treats a missing moderation field as approved', () => {
    expect(isPubliclyVisible({})).toBe(true);
  });

  it('shows an approved item and hides a pending or rejected one', () => {
    expect(isPubliclyVisible({ moderation: 'approved' })).toBe(true);
    expect(isPubliclyVisible({ moderation: 'pending' })).toBe(false);
    expect(isPubliclyVisible({ moderation: 'rejected' })).toBe(false);
  });
});

describe('list', () => {
  const items = [
    item({ id: 'approved-1' }),
    item({ id: 'pending-1', moderation: 'pending' }),
    item({ id: 'legacy-1', moderation: undefined }),
  ];

  it('hides unreviewed reports from an anonymous browser', async () => {
    const { service } = serviceFor(items);

    const result = await service.list({ limit: 50 } as never, undefined);

    expect(result.items.map((entry) => entry.id)).toEqual(['approved-1', 'legacy-1']);
  });

  it('shows an admin everything', async () => {
    const { service } = serviceFor(items);

    const result = await service.list({ limit: 50 } as never, ADMIN);

    expect(result.items).toHaveLength(3);
  });

  it('shows an owner their own unreviewed report', async () => {
    const { service } = serviceFor(items);

    const result = await service.list({ limit: 50, reportedBy: OWNER.uid } as never, OWNER);

    expect(result.items.map((entry) => entry.id)).toContain('pending-1');
  });

  /**
   * SEC: `?reportedBy=<victim-uid>` would enumerate another user's reports and
   * walk straight around the ownership guard on the per-user route.
   */
  it('refuses to list another user by id', async () => {
    const { service } = serviceFor(items);

    await expect(
      service.list({ limit: 50, reportedBy: OWNER.uid } as never, STRANGER),
    ).rejects.toThrow(AppError);
  });

  it('ignores a moderation filter from a non-admin', async () => {
    const { service } = serviceFor(items);

    const result = await service.list({ limit: 50, moderation: 'pending' } as never, undefined);

    // Not the pending item: the filter was dropped and ordinary visibility
    // applied instead.
    expect(result.items.map((entry) => entry.id)).not.toContain('pending-1');
  });
});

describe('getById', () => {
  /**
   * UI-07b: an unreviewed report stayed fully readable, reporter email and
   * collection point included, to anyone holding its id.
   */
  it('UI-07b hides an unreviewed report from a stranger', async () => {
    const { service } = serviceFor([item({ moderation: 'pending' })]);

    await expect(service.getById('item-1', STRANGER)).rejects.toThrow(/not found/i);
  });

  it('shows the reporter their own unreviewed report', async () => {
    const { service } = serviceFor([item({ moderation: 'pending' })]);

    await expect(service.getById('item-1', OWNER)).resolves.toMatchObject({ id: 'item-1' });
  });

  it('is a 404 rather than a 403, so the id itself is not confirmed', async () => {
    const { service } = serviceFor([item({ moderation: 'pending' })]);

    await expect(service.getById('item-1', STRANGER)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('is a 404 for an item that does not exist', async () => {
    const { service } = serviceFor([]);

    await expect(service.getById('nope', ADMIN)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('moderate', () => {
  /**
   * LOG-22: re-approving an already approved item would start a second
   * matching run against the same item.
   */
  it('LOG-22 refuses a decision that has already been made', async () => {
    const { service } = serviceFor([item({ moderation: 'approved' })]);

    await expect(
      service.moderate('item-1', { decision: 'approved' } as never, ADMIN.uid),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('records who decided and when', async () => {
    const { service, repo } = serviceFor([item({ moderation: 'pending' })]);

    await service.moderate('item-1', { decision: 'approved' } as never, ADMIN.uid);

    expect(repo.updates[0].data).toMatchObject({
      moderation: 'approved',
      moderatedBy: ADMIN.uid,
    });
  });

  it('starts matching on approval and not on rejection', async () => {
    const approved = serviceFor([item({ moderation: 'pending' })]);
    const rejected = serviceFor([item({ moderation: 'pending' })]);

    const onApproval = await approved.service.moderate(
      'item-1',
      { decision: 'approved' } as never,
      ADMIN.uid,
    );
    const onRejection = await rejected.service.moderate(
      'item-1',
      { decision: 'rejected', reason: 'Not a real report' } as never,
      ADMIN.uid,
    );

    expect(onApproval.matching).toBe('pending');
    expect(onRejection.matching).toBe('not_started');
  });

  /**
   * An approval on an already Matched or Claimed item is a moderation
   * decision, not a reason to re-run the pipeline over a settled pair.
   */
  it('does not re-match an item that is no longer Pending', async () => {
    const { service } = serviceFor([item({ moderation: 'pending', status: 'Claimed' })]);

    const result = await service.moderate('item-1', { decision: 'approved' } as never, ADMIN.uid);

    expect(result.matching).toBe('not_started');
  });
});

describe('update', () => {
  it('refuses to let one user edit another user report', async () => {
    const { service } = serviceFor([item()]);

    await expect(
      service.update('item-1', { updates: { name: 'Mine now' } } as never, STRANGER),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  /**
   * SEC-12: the write is built from an allowlist. Everything the server owns
   * has to stay out of reach of a request body.
   */
  it('SEC-12 ignores server-owned fields in the request body', async () => {
    const { service, repo } = serviceFor([item()]);

    await service.update(
      'item-1',
      {
        updates: {
          name: 'Renamed',
          reportedBy: 'someone-else',
          matchedItemId: 'item-9',
          verifiedBy: 'nobody',
        },
      } as never,
      OWNER,
    );

    const written = repo.updates[0].data;

    expect(written).toMatchObject({ name: 'Renamed' });
    expect(written).not.toHaveProperty('reportedBy');
    expect(written).not.toHaveProperty('matchedItemId');
    expect(written).not.toHaveProperty('verifiedBy');
  });

  /**
   * UI-07: `??` not `||`. An empty string is a request to clear the field, and
   * `||` turned it into undefined, which was then dropped, so the old value
   * survived an edit that was meant to remove it.
   */
  it('UI-07 lets an empty collection point clear the field', async () => {
    const { service, repo } = serviceFor([item({ collectionPoint: 'Old desk' })]);

    await service.update('item-1', { updates: { collectionPoint: '' } } as never, OWNER);

    expect(repo.updates[0].data).toMatchObject({ collectionPoint: '' });
  });

  it('lets an admin change the status and refuses the owner the same field', async () => {
    const byAdmin = serviceFor([item()]);
    const byOwner = serviceFor([item()]);

    await byAdmin.service.update('item-1', { updates: { status: 'Claimed' } } as never, ADMIN);
    await byOwner.service.update('item-1', { updates: { status: 'Claimed' } } as never, OWNER);

    expect(byAdmin.repo.updates[0].data).toMatchObject({ status: 'Claimed' });
    expect(byOwner.repo.updates[0].data).not.toHaveProperty('status');
  });

  /**
   * Images are only accepted as a removal: the edit form sends the URLs that
   * remain. Anything not already on the item would let a caller point the
   * record at an arbitrary URL.
   */
  it('refuses a cloudinary URL the item does not already own', async () => {
    const { service } = serviceFor([item({ cloudinaryUrls: ['https://cdn/one.jpg'] })]);

    await expect(
      service.update(
        'item-1',
        { updates: { cloudinaryUrls: ['https://evil.example/x.jpg'] } } as never,
        OWNER,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts a subset of the URLs the item already owns', async () => {
    const { service, repo } = serviceFor([
      item({ cloudinaryUrls: ['https://cdn/one.jpg', 'https://cdn/two.jpg'] }),
    ]);

    await service.update(
      'item-1',
      { updates: { cloudinaryUrls: ['https://cdn/one.jpg'] } } as never,
      OWNER,
    );

    expect(repo.updates[0].data).toMatchObject({ cloudinaryUrls: ['https://cdn/one.jpg'] });
  });
});

describe('rematch', () => {
  it('refuses an item that is not Pending', async () => {
    const { service } = serviceFor([item({ status: 'Matched' })]);

    await expect(service.rematch('item-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses an item that has not been approved', async () => {
    const { service } = serviceFor([item({ moderation: 'pending' })]);

    await expect(service.rematch('item-1')).rejects.toThrow(/Approve the item/);
  });

  it('refuses an item with no report date, which cannot be time-scored', async () => {
    const { service } = serviceFor([item({ date: undefined })]);

    await expect(service.rematch('item-1')).rejects.toThrow(/report date/);
  });
});

describe('remove', () => {
  it('refuses to let one user delete another user report', async () => {
    const { service } = serviceFor([item()]);

    await expect(service.remove('item-1', STRANGER)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lets an admin delete any report', async () => {
    const { service } = serviceFor([item()]);

    await expect(service.remove('item-1', ADMIN)).resolves.toBeUndefined();
  });
});
