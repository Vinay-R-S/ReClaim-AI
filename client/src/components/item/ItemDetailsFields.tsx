/**
 * The editable item fields both report flows show once analysis has run.
 *
 * The user modal and the admin modal each had their own copy of these five
 * inputs and their own tag add/remove handlers.
 */

export interface ItemDetailsValues {
  name: string;
  description: string;
  color: string;
  category: string;
  tags: string[];
}

interface ItemDetailsFieldsProps {
  values: ItemDetailsValues;
  onChange: (patch: Partial<ItemDetailsValues>) => void;
  /** Says the values were suggested by the model rather than typed. */
  aiGenerated?: boolean;
}

const INPUT_CLASS =
  'w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary';

export function ItemDetailsFields({
  values,
  onChange,
  aiGenerated = true,
}: ItemDetailsFieldsProps) {
  const suffix = aiGenerated ? ' (AI Generated)' : '';

  const addTag = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;

    event.preventDefault();

    const input = event.target as HTMLInputElement;
    const tag = input.value.trim();

    // Cleared only on a successful add: wiping the text for a duplicate reads
    // as a dropped keystroke.
    if (tag && !values.tags.includes(tag)) {
      onChange({ tags: [...values.tags, tag] });
      input.value = '';
    }
  };

  return (
    <>
      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-1 block font-medium">
          Item Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={values.name}
          onChange={(event) => onChange({ name: event.target.value })}
          className={INPUT_CLASS}
        />
      </div>

      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-1 block font-medium">Description</label>
        <textarea
          value={values.description}
          onChange={(event) => onChange({ description: event.target.value })}
          rows={3}
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-1 block font-medium">
          Primary Color{suffix}
        </label>
        <input
          type="text"
          value={values.color}
          onChange={(event) => onChange({ color: event.target.value })}
          className={INPUT_CLASS}
        />
      </div>

      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-1 block font-medium">
          Category{suffix}
        </label>
        <input
          type="text"
          value={values.category}
          onChange={(event) => onChange({ category: event.target.value })}
          className={INPUT_CLASS}
        />
      </div>

      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-2 block font-medium">Tags</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {values.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange({ tags: values.tags.filter((value) => value !== tag) })}
                className="hover:text-red-500"
                aria-label={`Remove tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          placeholder="Add more tags (press Enter)"
          onKeyDown={addTag}
          className={`${INPUT_CLASS} text-sm`}
        />
      </div>
    </>
  );
}
