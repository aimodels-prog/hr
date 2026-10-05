import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";

export function ProfilePhoto({
  employeeId,
  name,
  initials,
  editable,
}: {
  employeeId: string;
  name: string;
  initials: string;
  editable: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `/api/employee-photo?employeeId=${encodeURIComponent(employeeId)}&v=${version}`;
  async function upload(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > MAX_PROFILE_PHOTO_BYTES) {
      toast.error("Choose a JPG or PNG photo smaller than 5 MB.");
      return;
    }
    setBusy(true);
    try {
      // Decode and resize: removes location/camera metadata and keeps profile loading quick.
      const bitmap = await createImageBitmap(file);
      let blob: Blob;
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser could not prepare your photo.");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("Could not prepare the photo."))),
            "image/png",
          ),
        );
      } finally {
        bitmap.close();
      }
      const data = new FormData();
      data.append("photo", blob, "profile.png");
      const response = await fetch(url, { method: "POST", body: data });
      if (!response.ok)
        throw new Error("Photo could not be saved. Check your connection and try again.");
      setLoaded(false);
      setVersion((value) => value + 1);
      toast.success("Profile photo saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload your photo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="flex shrink-0 flex-col items-start gap-2">
      <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10 text-2xl font-bold">
        {!loaded && <span aria-label={`${name}'s initials`}>{initials}</span>}
        <img
          key={url}
          src={url}
          alt={`${name}'s profile photo`}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
          className={`absolute inset-0 h-full w-full object-cover ${loaded ? "" : "invisible"}`}
        />
      </div>
      {editable && (
        <>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png"
            aria-label="Choose profile photo"
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Camera className="h-3.5 w-3.5" />
            {busy ? "Uploading…" : loaded ? "Change photo" : "Upload photo"}
          </button>
        </>
      )}
    </div>
  );
}
