/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Plus, Edit2, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTableShell } from "@/components/ui/data-table-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import type { MasterRecord } from "@/lib/data/types";
import { EmptyState } from "@/components/ui/empty-state";

export interface MasterDataTableColumn<T> {
  key: string;
  label: string;
  render?: (record: T) => React.ReactNode;
}

export interface MasterDataTableProps<T extends MasterRecord> {
  title: string;
  data: T[];
  onAdd: () => void;
  onEdit: (record: T) => void;
  onArchive: (record: T) => void;
  onRestore: (record: T) => void;
  columns?: MasterDataTableColumn<T>[];
  showCode?: boolean;
}

export function MasterDataTable<T extends MasterRecord>({
  title,
  data,
  onAdd,
  onEdit,
  onArchive,
  onRestore,
  columns,
  showCode = true,
}: MasterDataTableProps<T>) {
  const [search, setSearch] = useState("");

  const filtered = data.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.code && r.code.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <FilterBar>
        <div className="flex w-full max-w-sm items-center space-x-2">
          <Input
            placeholder={`Search ${title}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={onAdd} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> Add {title}
        </Button>
      </FilterBar>

      <DataTableShell>
        <Table>
          <TableHeader>
            <TableRow>
              {showCode && <TableHead className="w-[100px]">Code</TableHead>}
              <TableHead>Name</TableHead>
              {columns?.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showCode ? 4 + (columns?.length || 0) : 3 + (columns?.length || 0)}
                  className="h-24 text-center"
                >
                  No records found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((record) => (
                <TableRow
                  key={record.id}
                  className={record.archivedAt ? "opacity-60 bg-muted/50" : ""}
                >
                  {showCode && <TableCell className="font-medium">{record.code || "-"}</TableCell>}
                  <TableCell>{record.name}</TableCell>
                  {columns?.map((col) => (
                    <TableCell key={col.key}>
                      {col.render ? col.render(record) : String((record as any)[col.key] || "-")}
                    </TableCell>
                  ))}
                  <TableCell>
                    <StatusBadge
                      status={
                        record.archivedAt ? "Archived" : record.isActive ? "Active" : "Inactive"
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(record)}>
                        <Edit2 className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      {record.archivedAt ? (
                        <Button variant="ghost" size="icon" onClick={() => onRestore(record)}>
                          <ArchiveRestore className="h-4 w-4" />
                          <span className="sr-only">Restore</span>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onArchive(record)}
                          className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
                        >
                          <Archive className="h-4 w-4" />
                          <span className="sr-only">Archive</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableShell>
    </div>
  );
}
