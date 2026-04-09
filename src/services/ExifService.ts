import exifr from 'exifr';

/**
 * Reads EXIF/metadata date from a local file.
 * Supports JPEG, PNG, HEIC, WebP, and common video formats (MP4, MOV).
 * Returns null if no date metadata is found.
 *
 * Uses a static import so pkg can bundle exifr automatically.
 */
export class ExifService {
  async getDate(filePath: string): Promise<Date | null> {
    try {
      const data = await exifr.parse(filePath, {
        pick: ['DateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'TrackCreateDate'],
      });

      if (!data) return null;

      const date =
        data.DateTimeOriginal ??
        data.CreateDate ??
        data.MediaCreateDate ??
        data.TrackCreateDate;

      if (date instanceof Date && !isNaN(date.getTime())) {
        return date;
      }
    } catch {
      // File may not have EXIF, or exifr cannot parse this format
    }

    return null;
  }
}
