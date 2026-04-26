// Utility: strips the two SettingsBase methods so DeepPartial and keyof-based
// helpers only see the actual data fields of a subclass.
export type DataOf<T extends SettingsBase> = Omit<T, keyof SettingsBase>;

// Recursive partial over data fields only. Nested SettingsBase values become
// DeepPartial themselves; everything else stays as-is (no deep-partial into
// plain objects like Record<string, X>).
export type DeepPartial<T extends SettingsBase> = {
  [K in keyof DataOf<T>]?: DataOf<T>[K] extends SettingsBase
    ? DeepPartial<DataOf<T>[K]>
    : DataOf<T>[K];
};

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export abstract class SettingsBase {
  // Merges a raw stored value into this instance, using `this` as the source of
  // defaults. Unknown or wrongly-typed fields in `raw` are silently ignored and
  // fall back to the default. Nested SettingsBase fields are recursed into
  // automatically — no extra wiring needed when adding new nested groups.
  fromPartial(raw: unknown): this {
    if (!isPlainObject(raw)) {
      return this;
    }

    const overrides: Record<string, unknown> = {};

    for (const key of Object.keys(this)) {
      const defaultVal = (this as Record<string, unknown>)[key];
      const storedVal = raw[key];

      if (storedVal === undefined) {
        continue;
      }

      if (defaultVal instanceof SettingsBase) {
        overrides[key] = defaultVal.fromPartial(storedVal);
      } else if (storedVal !== null && typeof storedVal === typeof defaultVal) {
        overrides[key] = storedVal;
      }
      // type mismatch or null → key omitted → default is kept via Object.assign below
    }

    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, overrides) as this;
  }

  // Returns a new instance with `patch` deep-merged into the current values.
  // Nested SettingsBase fields in the patch are deep-merged into the current
  // nested instance rather than replacing it entirely.
  update(patch: DeepPartial<this>): this {
    const overrides: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(patch as Record<string, unknown>)) {
      if (val === undefined) {
        continue;
      }

      const current = (this as Record<string, unknown>)[key];
      if (current instanceof SettingsBase && isPlainObject(val)) {
        overrides[key] = (current as SettingsBase).update(val as any);
      } else {
        overrides[key] = val;
      }
    }

    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, overrides) as this;
  }
}
