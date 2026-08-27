/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { MasterRecord } from "@/lib/data/types";
import type { NewRecord } from "@/lib/data/repository";

export interface MasterDataFormProps<T extends MasterRecord> {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (record: Partial<T>) => void;
  initialData?: T | null;
  showCode?: boolean;
  children?: (props: {
    formData: Partial<T>;
    updateField: (key: keyof T, value: any) => void;
  }) => React.ReactNode;
}

export function MasterDataForm<T extends MasterRecord>({
  title,
  isOpen,
  onClose,
  onSave,
  initialData,
  showCode = true,
  children,
}: MasterDataFormProps<T>) {
  const [formData, setFormData] = useState<Partial<T>>({});

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData(initialData);
      } else {
        setFormData({ isActive: true, orderIndex: 0 } as Partial<T>);
      }
    }
  }, [isOpen, initialData]);

  const updateField = (key: keyof T, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) return; // basic validation
    onSave(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialData ? "Edit" : "New"} {title}
            </DialogTitle>
            <DialogDescription>
              {initialData
                ? "Update the details for this record."
                : "Create a new record in the system."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name" className="required">
                Name
              </Label>
              <Input
                id="name"
                value={formData.name || ""}
                onChange={(e) => updateField("name" as keyof T, e.target.value)}
                placeholder="e.g. Operations"
                required
              />
            </div>

            {showCode && (
              <div className="grid gap-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  value={formData.code || ""}
                  onChange={(e) => updateField("code" as keyof T, e.target.value)}
                  placeholder="e.g. OPS"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description || ""}
                onChange={(e) => updateField("description" as keyof T, e.target.value)}
                placeholder="Optional description"
              />
            </div>

            {children && children({ formData, updateField })}

            <div className="flex items-center justify-between rounded-lg border p-3 mt-2 shadow-sm">
              <div className="space-y-0.5">
                <Label>Active Status</Label>
                <div className="text-sm text-muted-foreground">
                  Inactive records are hidden from standard selectors
                </div>
              </div>
              <Switch
                checked={formData.isActive !== false}
                onCheckedChange={(checked) => updateField("isActive" as keyof T, checked)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
