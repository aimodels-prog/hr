export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
export function profilePhotoMime(bytes: Uint8Array): "image/jpeg" | "image/png" {
  if (!bytes.length || bytes.length > MAX_PROFILE_PHOTO_BYTES)
    throw new Error("Choose a photo smaller than 5 MB.");
  const dimensions = (width: number, height: number) => {
    if (width < 1 || height < 1 || width > 4096 || height > 4096)
      throw new Error("Choose a photo no larger than 4096 pixels on either side.");
  };
  if (
    bytes.length > 32 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
    String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    dimensions(view.getUint32(16), view.getUint32(20));
    return "image/png";
  }
  if (
    bytes.length > 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217
  ) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 218 || marker === 217) break;
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) {
        dimensions(
          (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        );
        return "image/jpeg";
      }
      offset += length;
    }
  }
  throw new Error("Choose a JPG or PNG photo.");
}
export function canChangeProfilePhoto(
  viewerEmployeeId: string,
  targetEmployeeId: string,
  roles: readonly string[],
) {
  return (
    viewerEmployeeId === targetEmployeeId || roles.includes("HR") || roles.includes("Super Admin")
  );
}
