import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Search, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { OfferService } from "@/lib/data/offer-service";
import { CandidateService } from "@/lib/data/candidate-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import type { JobOfferStatus } from "@/lib/data/types";

export const Route = createFileRoute("/staff/offers")({
  component: OffersRoute,
});

const STATUS_ORDER: JobOfferStatus[] = [
  "Draft",
  "Pending Approval",
  "Approved",
  "Ready to Send",
  "Sent",
  "Accepted",
  "Declined",
  "Expired",
  "Withdrawn",
];

function OffersRoute() {
  const currentUser = useCurrentUser();
  const { can } = currentUser;
  const canViewComp = can("payroll:view") || can("employee:manage_all");
  const [offerService] = useState(() => new OfferService());
  const [candidateService] = useState(() => new CandidateService());
  const [vacancyService] = useState(() => new VacancyService());

  const offers = useMemo(
    () => offerService.getAllOffers(currentUser.getActorContext()),
    [offerService, currentUser],
  );
  const candidates = useMemo(
    () => candidateService.getDetailedCandidates(currentUser.getActorContext()),
    [candidateService, currentUser],
  );
  const vacancies = useMemo(() => vacancyService.getVacancyRepository().list(), [vacancyService]);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredOffers = useMemo(() => {
    return offers
      .filter((o) => statusFilter === "all" || o.status === statusFilter)
      .filter((o) => {
        if (!searchQuery) return true;
        const candidate = candidates.find((c) => c.id === o.candidateId);
        const vacancy = vacancies.find((v) => v.id === o.vacancyId);
        const haystack =
          `${candidate?.firstName || ""} ${candidate?.lastName || ""} ${vacancy?.title || ""} ${o.position}`.toLowerCase();
        return haystack.includes(searchQuery.toLowerCase());
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [offers, candidates, vacancies, statusFilter, searchQuery]);

  return (
    <RequirePermission permission="recruitment:manage_candidates" resourceName="Offers">
      <div className="flex h-full flex-col gap-6 p-6 max-w-[1400px] mx-auto">
        <div>
          <h1 className="font-display text-2xl font-semibold">Offers</h1>
          <p className="text-sm text-muted-foreground">
            All job offers across every vacancy. Create and manage individual offers from the
            vacancy's Decision panel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 shadow-sm">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by candidate, vacancy, position..."
              className="pl-9 bg-background"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px] bg-background">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Vacancy</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Status</TableHead>
                {canViewComp && <TableHead>Salary</TableHead>}
                <TableHead>Start Date</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOffers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canViewComp ? 7 : 6}
                    className="h-32 text-center text-muted-foreground"
                  >
                    No offers found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredOffers.map((offer) => {
                  const candidate = candidates.find((c) => c.id === offer.candidateId);
                  const vacancy = vacancies.find((v) => v.id === offer.vacancyId);
                  return (
                    <TableRow key={offer.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">
                        {candidate
                          ? `${candidate.firstName} ${candidate.lastName}`
                          : "Unknown Candidate"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {vacancy?.title || "Unknown Vacancy"}
                      </TableCell>
                      <TableCell className="text-sm">{offer.position}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            offer.status === "Accepted"
                              ? "default"
                              : offer.status === "Declined" ||
                                  offer.status === "Withdrawn" ||
                                  offer.status === "Expired"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {offer.status}
                        </Badge>
                      </TableCell>
                      {canViewComp && (
                        <TableCell className="text-sm">
                          {offer.salary ? offer.salary.toLocaleString() : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-sm">{offer.startDate || "—"}</TableCell>
                      <TableCell className="text-right">
                        {vacancy && (
                          <Link
                            to="/staff/vacancies/$vacancyId"
                            params={{ vacancyId: vacancy.id }}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <FileText className="h-3.5 w-3.5" /> Open Vacancy
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </RequirePermission>
  );
}
