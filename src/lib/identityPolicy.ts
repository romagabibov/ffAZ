export const identityCollections = ["agency_applications", "designer_applications"] as const;
export type IdentityCollection = typeof identityCollections[number];
export const identityPhotoFields = ["idCardPhotoUrl", "idDocumentUrl", "personalPhotoUrl"] as const;
export const maxIdentityPhotoBytes = 2_500_000;

export const isIdentityCollection = (name: unknown): name is IdentityCollection =>
  identityCollections.some((collection) => collection === name);
export const isIdentityPhoto = (purpose: unknown): purpose is "id_document" | "verification_photo" =>
  purpose === "id_document" || purpose === "verification_photo";
