import { MapPin } from "lucide-react";

import type { GeoReading } from "@/lib/data/attendance-types";

interface LocationMapProps {
  reading: GeoReading | null;
  title?: string;
}

export function LocationMap({ reading, title = "Current location" }: LocationMapProps) {
  if (!reading) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/30 p-6 text-center">
        <div>
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Your location will appear here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Allow browser location access to place your position on the map.
          </p>
        </div>
      </div>
    );
  }

  const { latitude, longitude, accuracyMeters } = reading;
  const bbox = [longitude - 0.008, latitude - 0.006, longitude + 0.008, latitude + 0.006].join(",");
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
  const fullMapUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=17/${latitude}/${longitude}`;

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <iframe
        title={title}
        src={mapUrl}
        className="h-72 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {latitude.toFixed(6)}, {longitude.toFixed(6)} · accuracy ±{Math.round(accuracyMeters)}m
        </span>
        <a
          href={fullMapUrl}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary hover:underline"
        >
          Open larger map
        </a>
      </div>
    </div>
  );
}
