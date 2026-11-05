'use strict';

// ═══════════════════════════════════════════════════
//  DEMONSTRATION DATA — entirely synthetic. No real patient information.
//
//  The bounding-box "AI findings" below (region of interest, confidence,
//  bbox coordinates) are pre-authored demo data standing in for what an
//  actual on-device medical imaging-detection model would output — no such
//  detection model is available on this device today. The narrative text
//  (draft impressions, comparison summaries, copilot answers) IS generated
//  live by the real on-device language model, grounded in this structured
//  data. See the "Responsible AI" page in the app for the same disclosure.
// ═══════════════════════════════════════════════════

function seedStudies() {
  const now = Date.now();
  const hoursAgo = h => new Date(now - h * 3600 * 1000).toISOString();

  return [
    {
      id: 'STU-2026-40112',
      accession: 'ACC-40112',
      patientId: 'MRN-88213',
      age: 45, sex: 'M',
      examType: 'Chest X-ray',
      bodyPart: 'Chest', modality: 'XR',
      image: 'images/chest-clean.png',
      receivedAt: hoursAgo(6),
      status: 'queued',
      clinicalPriority: 'routine',
      findings: [],
      processing: { status: 'complete', timeSeconds: 0.3, regionsDetected: 0, prioritized: false },
      priorStudy: null,
      aiSummaryHint: 'No region of interest met the confidence threshold for flagging. Lung fields, cardiac silhouette, and osseous structures appear grossly unremarkable in this synthetic demo case.',
      aiDraftImpression: null,
      radiologistImpression: '',
      annotations: [],
      auditLog: [{ ts: hoursAgo(6), actor: 'AI', action: 'Pre-screening complete — no regions flagged.' }],
      signedAt: null, signedBy: null, openedAt: null,
    },
    {
      id: 'STU-2026-40118',
      accession: 'ACC-40118',
      patientId: 'MRN-71940',
      age: 67, sex: 'F',
      examType: 'Chest X-ray',
      bodyPart: 'Chest', modality: 'XR',
      image: 'images/chest-opacity.png',
      receivedAt: hoursAgo(3),
      status: 'prioritized',
      clinicalPriority: 'high',
      findings: [
        {
          id: 'F1', roi: 'Right lower lung zone', findingType: 'Possible opacity', confidence: 0.82,
          bbox: { x: 0.66, y: 0.66, w: 0.14, h: 0.11 },
          status: 'pending', radiologistNote: '',
        },
      ],
      processing: { status: 'complete', timeSeconds: 0.4, regionsDetected: 1, prioritized: true },
      priorStudy: {
        date: dateMonthsAgo(14),
        examType: 'Chest X-ray',
        image: 'images/chest-prior.png',
        summary: 'No focal finding reported in the lower zones. Cardiac silhouette within normal limits.',
      },
      aiSummaryHint: 'One region of interest flagged in the right lower lung zone with confidence 0.82, consistent with a possible opacity. Recommend radiologist correlation with prior imaging and clinical history.',
      aiDraftImpression: null,
      radiologistImpression: '',
      annotations: [],
      auditLog: [{ ts: hoursAgo(3), actor: 'AI', action: 'Pre-screening complete — 1 region flagged, study prioritized (confidence 0.82 ≥ high-priority threshold).' }],
      signedAt: null, signedBy: null, openedAt: null,
    },
    {
      id: 'STU-2026-40125',
      accession: 'ACC-40125',
      patientId: 'MRN-55302',
      age: 58, sex: 'M',
      examType: 'Chest X-ray',
      bodyPart: 'Chest', modality: 'XR',
      image: 'images/chest-multi.png',
      receivedAt: hoursAgo(1.5),
      status: 'prioritized',
      clinicalPriority: 'stat',
      findings: [
        {
          id: 'F1', roi: 'Right lower lung zone', findingType: 'Possible opacity', confidence: 0.79,
          bbox: { x: 0.66, y: 0.66, w: 0.14, h: 0.11 },
          status: 'pending', radiologistNote: '',
        },
        {
          id: 'F2', roi: 'Left upper lung zone', findingType: 'Possible nodule', confidence: 0.58,
          bbox: { x: 0.16, y: 0.08, w: 0.09, h: 0.08 },
          status: 'pending', radiologistNote: '',
        },
      ],
      processing: { status: 'complete', timeSeconds: 0.5, regionsDetected: 2, prioritized: true },
      priorStudy: null,
      aiSummaryHint: 'Two regions of interest flagged: a possible opacity in the right lower lung zone (confidence 0.79) and a possible nodule in the left upper lung zone (confidence 0.58). No prior imaging available for comparison.',
      aiDraftImpression: null,
      radiologistImpression: '',
      annotations: [],
      auditLog: [{ ts: hoursAgo(1.5), actor: 'AI', action: 'Pre-screening complete — 2 regions flagged, study prioritized (STAT — multiple regions above threshold).' }],
      signedAt: null, signedBy: null, openedAt: null,
    },
    {
      id: 'STU-2026-40098',
      accession: 'ACC-40098',
      patientId: 'MRN-63187',
      age: 72, sex: 'F',
      examType: 'Abdominal X-ray',
      bodyPart: 'Abdomen', modality: 'XR',
      image: 'images/abdomen-1.png',
      receivedAt: hoursAgo(9),
      status: 'in_review',
      clinicalPriority: 'routine',
      findings: [
        {
          id: 'F1', roi: 'Left lower abdomen', findingType: 'Possible dilated bowel loop', confidence: 0.65,
          bbox: { x: 0.2, y: 0.52, w: 0.16, h: 0.12 },
          status: 'pending', radiologistNote: '',
        },
      ],
      processing: { status: 'complete', timeSeconds: 0.4, regionsDetected: 1, prioritized: false },
      priorStudy: {
        date: dateMonthsAgo(3),
        examType: 'Abdominal X-ray',
        image: 'images/abdomen-prior.png',
        summary: 'Nonspecific bowel gas pattern. No dilated loops. No free air identified.',
      },
      aiSummaryHint: 'One region of interest flagged in the left lower abdomen, possible dilated bowel loop, confidence 0.65 (below the automatic high-priority threshold). Comparison with prior study suggested.',
      aiDraftImpression: 'Possible dilated bowel loop in the left lower abdomen flagged for radiologist review (AI confidence 0.65). Comparison with prior study from 3 months ago suggested, which described a nonspecific gas pattern without dilated loops. AI draft — radiologist confirmation required.',
      radiologistImpression: '',
      annotations: [],
      auditLog: [
        { ts: hoursAgo(9), actor: 'AI', action: 'Pre-screening complete — 1 region flagged, confidence below prioritization threshold.' },
        { ts: hoursAgo(2), actor: 'Radiologist', action: 'Opened study for review.' },
      ],
      signedAt: null, signedBy: null, openedAt: hoursAgo(2),
    },
    {
      id: 'STU-2026-40071',
      accession: 'ACC-40071',
      patientId: 'MRN-49025',
      age: 34, sex: 'M',
      examType: 'Knee X-ray',
      bodyPart: 'Knee', modality: 'XR',
      image: 'images/knee-1.png',
      receivedAt: hoursAgo(20),
      status: 'read',
      clinicalPriority: 'routine',
      findings: [
        {
          id: 'F1', roi: 'Suprapatellar region', findingType: 'Possible joint effusion', confidence: 0.41,
          bbox: { x: 0.38, y: 0.42, w: 0.24, h: 0.1 },
          status: 'rejected', radiologistNote: 'Appearance consistent with normal soft-tissue shadowing, not a true effusion.',
        },
      ],
      processing: { status: 'complete', timeSeconds: 0.3, regionsDetected: 1, prioritized: false },
      priorStudy: null,
      aiSummaryHint: 'One low-confidence region of interest flagged in the suprapatellar region, possible joint effusion, confidence 0.41 — below the prioritization threshold.',
      aiDraftImpression: 'Low-confidence suprapatellar finding flagged (0.41) for radiologist review; osseous alignment otherwise unremarkable in this synthetic demo case. AI draft — radiologist confirmation required.',
      radiologistImpression: 'No significant joint effusion. Osseous structures intact, joint space preserved. No acute findings.',
      annotations: [],
      auditLog: [
        { ts: hoursAgo(20), actor: 'AI', action: 'Pre-screening complete — 1 low-confidence region flagged, not prioritized.' },
        { ts: hoursAgo(5), actor: 'Radiologist', action: 'Opened study for review.' },
        { ts: hoursAgo(4.9), actor: 'Radiologist', action: 'Rejected AI finding F1 — "Possible joint effusion".' },
        { ts: hoursAgo(4.8), actor: 'Radiologist', action: 'Marked study as read.' },
      ],
      signedAt: null, signedBy: null, openedAt: hoursAgo(5),
    },
    {
      id: 'STU-2026-39980',
      accession: 'ACC-39980',
      patientId: 'MRN-30871',
      age: 29, sex: 'F',
      examType: 'Chest X-ray',
      bodyPart: 'Chest', modality: 'XR',
      image: 'images/chest-clean.png',
      receivedAt: hoursAgo(30),
      status: 'signed',
      clinicalPriority: 'routine',
      findings: [],
      processing: { status: 'complete', timeSeconds: 0.3, regionsDetected: 0, prioritized: false },
      priorStudy: {
        date: dateMonthsAgo(9),
        examType: 'Chest X-ray',
        image: 'images/chest-prior.png',
        summary: 'No focal consolidation. Heart size normal. No pleural effusion.',
      },
      aiSummaryHint: 'No region of interest met the confidence threshold. Comparable to prior study.',
      aiDraftImpression: 'No AI-flagged regions of interest identified. Comparable to prior study from 9 months ago, which was also unremarkable. AI draft — radiologist confirmation required.',
      radiologistImpression: 'No acute cardiopulmonary process. Stable compared to prior. Lungs clear, heart size normal.',
      annotations: [],
      auditLog: [
        { ts: hoursAgo(30), actor: 'AI', action: 'Pre-screening complete — no regions flagged.' },
        { ts: hoursAgo(26), actor: 'Radiologist', action: 'Opened study for review.' },
        { ts: hoursAgo(25.9), actor: 'Radiologist', action: 'Wrote final impression.' },
        { ts: hoursAgo(25.8), actor: 'Radiologist', action: 'Signed and finalized report.' },
      ],
      signedAt: hoursAgo(25.8), signedBy: 'Dr. A. Bennis', openedAt: hoursAgo(26),
    },
    {
      id: 'STU-2026-40131',
      accession: 'ACC-40131',
      patientId: 'MRN-92004',
      age: 51, sex: 'M',
      examType: 'Chest X-ray',
      bodyPart: 'Chest', modality: 'XR',
      image: 'images/chest-clean.png',
      receivedAt: hoursAgo(0.15),
      status: 'processing',
      clinicalPriority: 'routine',
      findings: [],
      processing: { status: 'pending', timeSeconds: null, regionsDetected: null, prioritized: null },
      priorStudy: null,
      aiSummaryHint: 'One low-to-moderate region of interest in the right mid lung zone, possible early infiltrate, confidence 0.58 — near the prioritization threshold.',
      pendingFindings: [
        {
          id: 'F1', roi: 'Right mid lung zone', findingType: 'Possible early infiltrate', confidence: 0.58,
          bbox: { x: 0.6, y: 0.42, w: 0.13, h: 0.1 },
          status: 'pending', radiologistNote: '',
        },
      ],
      aiDraftImpression: null,
      radiologistImpression: '',
      annotations: [],
      auditLog: [{ ts: hoursAgo(0.15), actor: 'System', action: 'Study received — queued for AI pre-screening.' }],
      signedAt: null, signedBy: null, openedAt: null,
    },
  ];
}

function dateMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}
