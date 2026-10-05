import { useEffect, useState } from "react";
import { SettingsService } from "@/lib/data/settings-service";
import { useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LeaveDayCounting() {
  const { getActorContext } = useCurrentUser();
  const [service] = useState(() => new SettingsService());
  const [saved, setSaved] = useState<boolean | null>(null);
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    void service
      .getAppSettings()
      .then((settings) => {
        setSaved(settings.leaveIncludesWeekends !== false);
        setInclude(settings.leaveIncludesWeekends !== false);
      })
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    let active = true;
    void service
      .getAppSettings()
      .then((settings) => {
        if (!active) return;
        setSaved(settings.leaveIncludesWeekends !== false);
        setInclude(settings.leaveIncludesWeekends !== false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [service]);
  const save = async () => {
    setBusy(true);
    try {
      const current = await service.getAppSettings();
      if (current.leaveIncludesWeekends !== include) {
        await service.saveAppSettings(
          { ...current, leaveIncludesWeekends: include },
          getActorContext(),
        );
      }
      setSaved(include);
      toast.success("Leave day counting updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save leave settings");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Counting leave days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed ? (
          <Button variant="outline" onClick={load}>
            Retry loading leave settings
          </Button>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="leave-weekends">Include weekends</Label>
              <Switch
                id="leave-weekends"
                checked={include}
                disabled={saved === null || busy}
                onCheckedChange={setInclude}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {include
                ? "Weekends count towards leave."
                : "Only the company's working days count towards leave."}{" "}
              Public holidays are excluded.
            </p>
            <p className="text-xs text-muted-foreground">
              Applies to all leave types for new requests and date amendments. Existing recorded
              totals stay unchanged.
            </p>
            <Button onClick={save} disabled={saved === null || saved === include || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
