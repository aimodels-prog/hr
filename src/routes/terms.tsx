import { createFileRoute } from "@tanstack/react-router";

import { PublicInformationPage } from "@/components/public-information-page";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms | VIA International Careers" }] }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicInformationPage
      eyebrow="Terms of use"
      title="Using the VIA Careers portal"
      introduction="These terms support a fair, reliable and secure application process for every candidate."
    >
      <section>
        <h2>Your application</h2>
        <p>
          Provide information that is accurate and belongs to you. Do not upload malicious files,
          confidential information belonging to another person, or documents unrelated to the
          position. Submitting an application does not guarantee an interview, offer or employment.
        </p>
      </section>
      <section>
        <h2>Vacancies and availability</h2>
        <p>
          VIA may update, pause or close a vacancy as recruitment needs change. We aim to keep the
          portal available and accurate, but temporary maintenance or technical interruption may
          occur.
        </p>
      </section>
      <section>
        <h2>Content and acceptable use</h2>
        <p>
          VIA names, branding and published content may not be misrepresented or reused in a way
          that suggests unauthorised endorsement. Attempts to interfere with the portal, bypass its
          security or access another person’s information are prohibited.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          If you experience a problem with an application, contact{" "}
          <a href="mailto:hr@via-int.com">hr@via-int.com</a>
          and include the position title without sending passwords or unnecessary sensitive data.
        </p>
      </section>
    </PublicInformationPage>
  );
}
