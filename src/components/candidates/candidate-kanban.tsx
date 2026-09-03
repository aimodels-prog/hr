import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Candidate, CandidateApplication, Vacancy } from "@/lib/data/types";

type KanbanCandidate = Candidate & { applications: CandidateApplication[] };

interface CandidateKanbanProps {
  candidates: KanbanCandidate[];
  projectNameById: Map<string, string>;
  vacancies: Vacancy[];
  userById: Map<string, string>;
  onStageChange: (candidateId: string, newStage: Candidate["stage"]) => void;
  onArchive: (candidate: KanbanCandidate) => void;
}

const KANBAN_STAGES = [
  "Sourced",
  "Applied",
  "Screened",
  "Shortlisted",
  "Interview",
  "Offer",
] satisfies Candidate["stage"][];

export function CandidateKanban({
  candidates,
  projectNameById,
  vacancies,
  userById,
  onStageChange,
  onArchive,
}: CandidateKanbanProps) {
  const navigate = useNavigate();
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setTimeout(() => {
      if (e.target instanceof HTMLElement) {
        e.target.style.opacity = "0.5";
      }
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedId(null);
    if (e.target instanceof HTMLElement) {
      e.target.style.opacity = "1";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, stage: Candidate["stage"]) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id && id !== "") {
      onStageChange(id, stage);
    }
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 h-full min-h-[600px] w-full">
      {KANBAN_STAGES.map((stage) => {
        const stageCandidates = candidates.filter((c) => c.stage === stage);
        return (
          <div
            key={stage}
            className="flex flex-col min-w-[300px] max-w-[300px] rounded-xl border bg-muted/30"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, stage)}
          >
            <div className="p-3 border-b flex items-center justify-between bg-muted/50 rounded-t-xl">
              <h3 className="font-semibold text-sm">{stage}</h3>
              <Badge variant="secondary">{stageCandidates.length}</Badge>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {stageCandidates.map((candidate) => {
                const recentApp = [...candidate.applications].sort((a, b) =>
                  b.createdAt.localeCompare(a.createdAt),
                )[0];
                const vacancy = recentApp
                  ? vacancies.find((v) => v.id === recentApp.vacancyId)
                  : null;

                return (
                  <div
                    key={candidate.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, candidate.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => navigate({ to: `/staff/candidates/${candidate.id}` })}
                    className={`cursor-grab active:cursor-grabbing p-3 rounded-lg border bg-card shadow-sm hover:shadow transition-shadow ${candidate.doNotContact ? "border-red-500/50 bg-red-500/5" : ""}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-medium text-sm flex items-center gap-1.5">
                        {candidate.firstName} {candidate.lastName}
                        {candidate.doNotContact && (
                          <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mb-3 truncate">
                      {candidate.currentTitle || "No title"} • {candidate.yearsOfExperience} yrs
                    </div>

                    {vacancy && (
                      <div className="text-xs bg-primary/5 text-primary px-2 py-1 rounded-md truncate mb-2">
                        {vacancy.title}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                      <span className="truncate max-w-[120px]">
                        {candidate.projectId
                          ? projectNameById.get(candidate.projectId)
                          : candidate.location}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onArchive(candidate);
                        }}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {stageCandidates.length === 0 && (
                <div className="h-20 flex items-center justify-center text-xs text-muted-foreground border-2 border-dashed rounded-lg">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
