const normalizeIdentity = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

export const getSparePartDuplicateKeys = ({ name, partCode }) => {
  const normalizedName = normalizeIdentity(name);
  const normalizedCode = normalizeIdentity(partCode);
  return [
    normalizedName && `name:${normalizedName}`,
    normalizedCode && `code:${normalizedCode}`,
  ].filter(Boolean);
};

export const isSparePartDuplicate = ({ name, partCode }, existingKeys) =>
  getSparePartDuplicateKeys({ name, partCode }).some((key) => existingKeys.has(key));

export const addSparePartDuplicateKeys = ({ name, partCode }, existingKeys) => {
  getSparePartDuplicateKeys({ name, partCode }).forEach((key) => existingKeys.add(key));
};
