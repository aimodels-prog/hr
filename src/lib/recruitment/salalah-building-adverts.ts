/** Draft advert copy for the Salalah building project. HR reviews these before publication. */
export type SalalahBuildingAdvert = {
  title: string;
  position: string;
  headcount: number;
  assignmentMonths: number;
  summary: string;
  education: string;
  minimumExperience: string;
  responsibilities: string[];
  requirements: string[];
};

const PROJECT =
  "VIA International Engineering Consultancy is recruiting for a building project in Salalah, Oman.";

export const existingSalalahQuantitySurveyorHeadcount = 1;
export const existingSalalahQuantitySurveyorAssignmentMonths = 12;

export const salalahBuildingAdverts: readonly SalalahBuildingAdvert[] = [
  {
    title: "Junior Architect — Salalah",
    position: "Junior Architect",
    headcount: 1,
    assignmentMonths: 12,
    summary: `${PROJECT} We are seeking Junior Architects to support architectural design coordination and site delivery. Apply directly through the careers form. Assignment duration: 12 months.`,
    education: "Relevant qualification in architecture or a related discipline.",
    minimumExperience: "Relevant experience with building drawings or architectural coordination.",
    responsibilities: [
      "Prepare and review architectural drawings and project documentation.",
      "Coordinate architectural details with the design and site teams.",
      "Help resolve architectural queries during building construction.",
    ],
    requirements: [
      "Relevant qualification in architecture or a related discipline.",
      "Relevant experience with building drawings or architectural coordination.",
      "Ability to work accurately with drawings and communicate with a multidisciplinary team.",
    ],
  },
  {
    title: "Electrical Engineer — Salalah",
    position: "Electrical Engineer",
    headcount: 1,
    assignmentMonths: 12,
    summary: `${PROJECT} We are seeking Electrical Engineers for building-services coordination and site supervision. Apply directly through the careers form. Assignment duration: 12 months.`,
    education: "Relevant qualification in electrical engineering.",
    minimumExperience: "Relevant experience with electrical systems on building projects.",
    responsibilities: [
      "Review electrical drawings, submittals and installation work.",
      "Coordinate electrical works with the architectural, structural and mechanical teams.",
      "Support site inspections, testing and reporting.",
    ],
    requirements: [
      "Relevant qualification in electrical engineering.",
      "Relevant experience with electrical systems on building projects.",
      "Ability to identify and communicate technical and quality issues on site.",
    ],
  },
  {
    title: "Mechanical Engineer — Salalah",
    position: "Mechanical Engineer",
    headcount: 1,
    assignmentMonths: 12,
    summary: `${PROJECT} We are seeking Mechanical Engineers for building-services coordination and site supervision. Apply directly through the careers form. Assignment duration: 12 months.`,
    education: "Relevant qualification in mechanical engineering.",
    minimumExperience: "Relevant experience with mechanical systems on building projects.",
    responsibilities: [
      "Review mechanical drawings, submittals and installation work.",
      "Coordinate building-services works with other disciplines and the site team.",
      "Support inspections, testing, commissioning and reporting.",
    ],
    requirements: [
      "Relevant qualification in mechanical engineering.",
      "Relevant experience with mechanical systems on building projects.",
      "Ability to identify and communicate technical and quality issues on site.",
    ],
  },
  {
    title: "Civil Inspector — Salalah",
    position: "Civil Inspector",
    headcount: 1,
    assignmentMonths: 12,
    summary: `${PROJECT} We are seeking Civil Inspectors to monitor and document building construction work on site. Apply directly through the careers form. Assignment duration: 12 months.`,
    education: "Relevant qualification in civil engineering or construction.",
    minimumExperience: "Relevant experience inspecting civil works on building projects.",
    responsibilities: [
      "Inspect site work against approved drawings and specifications.",
      "Record inspection findings and follow up on corrective actions.",
      "Coordinate with engineers and contractors on site quality matters.",
    ],
    requirements: [
      "Relevant qualification in civil engineering or construction.",
      "Relevant experience inspecting civil works on building projects.",
      "Ability to read drawings and produce clear inspection records.",
    ],
  },
  {
    title: "Land Surveyor — Salalah",
    position: "Land Surveyor",
    headcount: 1,
    assignmentMonths: 3,
    summary: `${PROJECT} We are seeking Land Surveyors to support site setting-out and survey records. Apply directly through the careers form. Assignment duration: 3 months.`,
    education: "Relevant qualification in surveying, geomatics or a related field.",
    minimumExperience: "Relevant experience surveying construction sites.",
    responsibilities: [
      "Carry out site setting-out, level checks and measurements.",
      "Prepare accurate survey records and as-built information.",
      "Coordinate survey information with engineers and the site team.",
    ],
    requirements: [
      "Relevant qualification in surveying, geomatics or a related field.",
      "Relevant experience surveying construction sites.",
      "Ability to use survey equipment and maintain accurate records.",
    ],
  },
  {
    title: "Document Controller — Salalah",
    position: "Document Controller",
    headcount: 1,
    assignmentMonths: 12,
    summary: `${PROJECT} We are seeking Document Controllers to keep project information accurate and accessible to the building team. Apply directly through the careers form. Assignment duration: 12 months.`,
    education:
      "Relevant qualification or practical training in document control or administration.",
    minimumExperience: "Relevant experience controlling documents for construction projects.",
    responsibilities: [
      "Register and track drawings, submittals, correspondence and revisions.",
      "Distribute current approved documents to the correct project teams.",
      "Maintain orderly records and support document handover.",
    ],
    requirements: [
      "Relevant qualification or practical training in document control or administration.",
      "Relevant experience controlling documents for construction projects.",
      "Careful version control, record keeping and communication.",
    ],
  },
];
