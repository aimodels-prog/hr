import { createFileRoute } from "@tanstack/react-router";

import { PublicInformationPage } from "@/components/public-information-page";

export const Route = createFileRoute("/candidate-privacy")({
  head: () => ({ meta: [{ title: "Candidate Privacy | VIA International" }] }),
  component: CandidatePrivacyPage,
});

function CandidatePrivacyPage() {
  return (
    <PublicInformationPage
      eyebrow="Candidate information"
      title="How we handle your application"
      introduction="This notice explains how VIA International uses the information you provide when you apply for a position or are considered for an opportunity."
    >
      <section>
        <h2>Information we receive</h2>
        <p>
          We may receive your contact details, CV, employment and education history, certifications,
          application answers, interview records, references and information you choose to provide.
          We may also record who introduced or recommended you.
        </p>
      </section>
      <section>
        <h2>How we use it</h2>
        <ul>
          <li>To manage your application and communicate with you.</li>
          <li>To assess your experience against the requirements of a role.</li>
          <li>To arrange interviews, record decisions and prepare an offer when applicable.</li>
          <li>To consider you for another suitable role where appropriate.</li>
          <li>To maintain recruitment records, protect the process and meet legal obligations.</li>
        </ul>
      </section>
      <section>
        <h2>Assessment and decisions</h2>
        <p>
          Technology may help VIA organise application information and identify relevant evidence.
          Recruitment decisions remain subject to human review. A recommendation does not improve an
          assessment score or guarantee an interview or offer.
        </p>
      </section>
      <section>
        <h2>Who may access it</h2>
        <p>
          Access is limited to people involved in recruitment, interview and approved
          administration. Information is not made available to other candidates. Service providers
          may process information only where required to operate or protect the recruitment service.
        </p>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          You may ask VIA to update inaccurate information, withdraw an active application or
          request information about the handling of your candidate record, subject to applicable
          legal and record-keeping requirements. Contact{" "}
          <a href="mailto:hr@via-int.com">hr@via-int.com</a>.
        </p>
      </section>
      <section>
        <h2>Submitting an application</h2>
        <p>
          Apply through an open position on this Careers portal so your application and original CV
          are received together and can be tracked correctly. Please do not send passwords,
          unnecessary identity documents or banking information with a job application.
        </p>
      </section>
    </PublicInformationPage>
  );
}
