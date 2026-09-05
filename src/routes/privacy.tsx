import { createFileRoute } from "@tanstack/react-router";

import { PublicInformationPage } from "@/components/public-information-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy | VIA International Careers" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PublicInformationPage
      eyebrow="Privacy"
      title="Your information on the Careers portal"
      introduction="VIA International uses personal information only for clear recruitment, communication, security and legal purposes."
    >
      <section>
        <h2>Information collected</h2>
        <p>
          When you browse or apply, the portal may process the information you enter, your uploaded
          documents and limited technical information needed to operate, secure and troubleshoot the
          service.
        </p>
      </section>
      <section>
        <h2>Use and protection</h2>
        <p>
          VIA limits access according to recruitment responsibilities and applies controls intended
          to protect information from unauthorised access, alteration or disclosure. Recruitment
          information is kept only for as long as needed for the relevant purpose and applicable
          record-keeping requirements.
        </p>
      </section>
      <section>
        <h2>Questions and requests</h2>
        <p>
          For questions about candidate information, corrections or privacy rights available to you
          under applicable law, email <a href="mailto:hr@via-int.com">hr@via-int.com</a>. Candidates
          should also read the <a href="/candidate-privacy">Candidate Privacy Notice</a>.
        </p>
      </section>
    </PublicInformationPage>
  );
}
