import { SafeForm } from "@/components/ui/safe-form";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import { type ReminderRules, ReminderRulesSchema } from "@/lib/data/reminder-rules";
import {
  getReminderRulesFn,
  saveReminderRulesFn,
} from "@/lib/server-functions/reminder-rules.server";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export function ReminderSettingsPanel() {
  const user = useCurrentUser();
  const [rules, setRules] = useState<ReminderRules>();
  const [training, setTraining] = useState("");
  const [carry, setCarry] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const actorKey = JSON.stringify({
    actorId: user.id,
    actorEmail: user.workspaceEmail,
    activeRole: user.activeRole,
  });
  useEffect(() => {
    let active = true;
    setRules(undefined);
    void getReminderRulesFn({ data: JSON.parse(actorKey) })
      .then((value) => {
        if (!active) return;
        setRules(value);
        setTraining(value.trainingExpiryDays.join(", "));
        setCarry(value.carryExtraDays.join(", "));
      })
      .catch(() => {
        if (active)
          setError("Reminder settings could not be loaded. Reload this page to try again.");
      });
    return () => {
      active = false;
    };
  }, [actorKey]);
  if (!rules) return <p role="status">{error || "Loading reminder settings…"}</p>;
  const change = <K extends keyof ReminderRules>(key: K, value: ReminderRules[K]) =>
    setRules({ ...rules, [key]: value });
  const toggle = (
    key:
      | "travelEnabled"
      | "trainingEnabled"
      | "leaveEnabled"
      | "offerEnabled"
      | "missingClockoutEnabled",
    label: string,
  ) => (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={key}>{label}</label>
      <Switch id={key} checked={rules[key]} onCheckedChange={(value) => change(key, value)} />
    </div>
  );
  const number = (
    key: "travelAfterHours" | "annualEveryMonths" | "offerBeforeHours",
    label: string,
    max: number,
  ) => (
    <label className="block space-y-2" htmlFor={key}>
      <span>{label}</span>
      <Input
        id={key}
        type="number"
        min="1"
        max={max}
        step="1"
        value={rules[key]}
        onChange={(e) => change(key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <SafeForm
      className="space-y-5 max-w-3xl"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
          const list = (text: string) =>
            text.trim() ? text.split(",").map((v) => (v.trim() ? Number(v.trim()) : NaN)) : [];
          const checked = ReminderRulesSchema.safeParse({
            ...rules,
            trainingExpiryDays: list(training),
            carryExtraDays: list(carry),
          });
          if (!checked.success)
            throw new Error(checked.error.issues[0]?.message ?? "Check reminder settings.");
          const saved = await saveReminderRulesFn({
            data: { actor: JSON.parse(actorKey), rules: checked.data },
          });
          setRules(saved);
          toast.success("Reminder settings saved.");
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Reminders could not be saved.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Changes apply to future reminders. Previously sent messages are not recalled. Email delivery
        must also be enabled in Google Calendar &amp; Meet.
      </p>
      <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>Daily email summaries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One email per employee each day. HR receives one email per topic, with all related
              items together. New items after the summary wait until the next day. In-app alerts
              remain immediate.
            </p>
            <label className="block space-y-2" htmlFor="dailyEmailTime">
              <span>Send from (company time zone)</span>
              <Input
                id="dailyEmailTime"
                type="time"
                value={rules.dailyEmailTime}
                onChange={(event) => change("dailyEmailTime", event.target.value)}
              />
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Travel approvals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {toggle("travelEnabled", "Send overdue reminders")}
            {number("travelAfterHours", "Remind after waiting (hours)", 720)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Training expiry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {toggle("trainingEnabled", "Send expiry reminders")}
            <label className="block space-y-2" htmlFor="training-days">
              <span>Days before expiry</span>
              <Input
                id="training-days"
                value={training}
                onChange={(e) => setTraining(e.target.value)}
                placeholder="60, 30, 14, 7, 0"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Separate days with commas. 0 means the expiry day. Expired certificates receive one
              further notice.
            </p>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>Leave planning</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {toggle("leaveEnabled", "Send leave planning reminders")}
            {number("annualEveryMonths", "Annual leave reminder interval (months)", 12)}
            <label className="block space-y-2" htmlFor="carry-deadline">
              <span>Carried-over leave target date (MM-DD)</span>
              <Input
                id="carry-deadline"
                value={rules.carryDeadline}
                onChange={(e) => change("carryDeadline", e.target.value)}
                placeholder="04-30"
              />
            </label>
            <label className="block space-y-2" htmlFor="carry-days">
              <span>Extra reminders before the target (days)</span>
              <Input id="carry-days" value={carry} onChange={(e) => setCarry(e.target.value)} />
            </label>
            <p className="text-xs text-muted-foreground">
              Carried-over leave has monthly reminders plus these extra warnings. This target does
              not expire or deduct leave.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Offer deadlines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {toggle("offerEnabled", "Send advance warnings")}
            {number("offerBeforeHours", "Warn before the deadline (hours)", 720)}
            <p className="text-xs text-muted-foreground">
              Offer expiry and its decision notice remain unchanged.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Missing clock-outs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {toggle("missingClockoutEnabled", "Send next-morning reminders")}
            {(["missingClockoutStart", "missingClockoutEnd"] as const).map((key, i) => (
              <label key={key} className="block space-y-2" htmlFor={key}>
                <span>{i ? "Morning window ends" : "Morning window starts"}</span>
                <Input
                  id={key}
                  type="time"
                  min="06:00"
                  max="12:00"
                  value={rules[key]}
                  onChange={(e) => change(key, e.target.value)}
                />
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Uses company local time, between 6 am and noon. Never sends an evening reminder to
              leave.
            </p>
          </CardContent>
        </Card>
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button disabled={saving}>{saving ? "Saving…" : "Save reminder settings"}</Button>
    </SafeForm>
  );
}
