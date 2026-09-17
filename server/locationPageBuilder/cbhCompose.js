// ── Clear Behavioral Health page scaffold ───────────────────────────────────
// Builds the L1+L2 skeleton for the CBH contract (cbhContract.js) with every
// FIXED heading already filled in and every generated field left empty for the
// writer.
//
// Separate from compose.buildDentalScaffold because the two contracts share no
// section. The dental body is a flat list of H2 blocks whose bodies are HTML
// with headings forbidden inside; this one has nine named sections, one of
// which nests 4-5 H3s under a single H2 and budgets each of them in LINES.
//
// The fixed headings are never sent to the writer to produce. The guidelines
// say "use this H2 exactly as written", and the surest way to honour that is
// for the model to have no opportunity to reword it.

const contract = require('./cbhContract');
const { dentalPageUrl, canonicalDentalUrl } = require('./urlBuilder');

const { FIXED_HEADINGS } = contract;

// The service name as it reads inside a heading. Service records are titled
// for a menu ("Anxiety", "ADHD"), and the guidelines' headings read as prose --
// "Our approach to anxiety treatment", not "Our approach to Anxiety".
//
// Casing is the client's, not ours. Deriving display text from the KEYWORD
// phrase (which is lowercase by design) and title-casing it back produced
// "Adhd Treatment" for ADHD and "Bipolar i And ii" for Bipolar I & II.
function headingService(service, servicePhraseFn) {
  const phrase = servicePhraseFn ? servicePhraseFn(service?.name) : '';
  return (phrase || service?.name || '').trim();
}

function buildCbhScaffold(layers, { servicePhrase } = {}) {
  const { client, service, location } = layers;
  const baseUrl = client.brand_static?.base_url || '';
  const urlPath = dentalPageUrl(location.location_page_url, service.slug);
  const canonical = canonicalDentalUrl(baseUrl, location.location_page_url, service.slug);

  const svcPhrase = headingService(service, servicePhrase);
  const cityName = location.city;

  return {
    meta: {
      page_id: '', client_id: client.id, service_id: service.id, location_id: location.id,
      status: 'draft',
      urlPath, canonical,
      brandName: contract.BRAND,
      // `title` is the part the 50-60 window applies to; `fullTitle` is what
      // ships. Both are stored so nothing downstream has to re-derive which is
      // which, and QC can gate them separately.
      title: '',
      fullTitle: '',
      metaDescription: '',
    },

    // Denormalised onto the page because QC, the exporter and the wizard all
    // need them and none of them load the service/location rows.
    serviceName: svcPhrase,
    locationName: cityName,
    primaryKeyword: '',
    primaryKeywords: [],
    secondaryKeywords: [],

    sections: {
      hero: {
        h1: '',
        description: '',
        ctaLabel: 'Schedule a consultation',
        ctaUrl: location.appointment_url || location.location_page_url || '',
      },

      approach: {
        heading: contract.approachHeading(svcPhrase),
        paragraphs: [],
        philosophy: { heading: FIXED_HEADINGS.approachPhilosophy, paragraphs: [] },
        therapies: { heading: FIXED_HEADINGS.approachTherapies, paragraphs: [] },
      },

      insurance: {
        heading: FIXED_HEADINGS.insurance,
        paragraph: '',
      },

      educational: {
        heading: contract.educationalHeading(svcPhrase),
        paragraphs: [],
        // Provenance for the intro itself; the H3s carry their own.
        source: null,
        sourceUrl: '',
        // Each: { heading, lines: [], source, sourceUrl }. `lines` rather than
        // a blob because the guidelines budget this content in lines, and a
        // bullet counts as one -- keeping them separate is what lets QC count
        // the way the guidelines count.
        h3s: [],
      },

      uvp: {
        heading: FIXED_HEADINGS.uvp,
        paragraph: '',
      },

      service: {
        heading: contract.serviceHeading(svcPhrase, cityName),
        paragraph: '',
      },

      faq: {
        heading: 'Frequently Asked Questions',
        // Each: { q, a, type } where type is location | brand | intent.
        items: [],
      },
    },

    schema: {},
    qc: null,
  };
}

// Merge the writer's output into the scaffold. Only the generated fields are
// touched: every fixed heading survives whatever the model returned, which is
// what makes "use this H2 exactly as written" a guarantee rather than a hope.
function mergeCbhL3(scaffold, l3 = {}) {
  const s = scaffold.sections;
  const str = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const list = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

  if (l3.metaTitle) {
    scaffold.meta.title = contract.titleWithoutSuffix(str(l3.metaTitle));
    scaffold.meta.fullTitle = contract.fullTitle(scaffold.meta.title);
  }
  if (l3.metaDescription) scaffold.meta.metaDescription = str(l3.metaDescription);

  if (l3.hero) {
    s.hero.h1 = str(l3.hero.h1) || s.hero.h1;
    s.hero.description = str(l3.hero.description) || s.hero.description;
  }

  if (l3.approach) {
    s.approach.paragraphs = list(l3.approach.paragraphs);
    s.approach.philosophy.paragraphs = list(l3.approach.philosophy);
    s.approach.therapies.paragraphs = list(l3.approach.therapies);
  }

  if (l3.insurance) s.insurance.paragraph = str(l3.insurance);
  if (l3.uvp) s.uvp.paragraph = str(l3.uvp);
  if (l3.service) s.service.paragraph = str(l3.service);

  if (l3.educational) {
    s.educational.paragraphs = list(l3.educational.paragraphs);
    s.educational.h3s = (l3.educational.h3s || []).map(h => ({
      heading: str(h.heading),
      lines: list(h.lines),
      // Provenance is decided by the pipeline, not by the model: the writer
      // does not get to declare its own output competitor-backed.
      source: null,
      sourceUrl: '',
    })).filter(h => h.heading);
  }

  if (Array.isArray(l3.faqs)) {
    s.faq.items = l3.faqs
      .map(f => ({
        q: str(f.q),
        a: str(f.a),
        type: ['location', 'brand', 'intent'].includes(f.type) ? f.type : null,
      }))
      .filter(f => f.q && f.a);
  }

  return scaffold;
}

// Stamps the provenance the pipeline determined onto the educational section.
// `plan` is the brief's H3 list, which knows which headings came from
// competitor research and which were filled from an authoritative source.
function applyProvenance(scaffold, plan = []) {
  const s = scaffold.sections.educational;
  s.h3s = s.h3s.map((h, i) => {
    const planned = plan[i] || {};
    return { ...h, source: planned.source || null, sourceUrl: planned.sourceUrl || '' };
  });
  // The intro is competitor-driven whenever any H3 is; it is written from the
  // same research pass.
  s.source = s.h3s.some(h => h.source === contract.PROVENANCE.COMPETITOR)
    ? contract.PROVENANCE.COMPETITOR
    : (s.h3s.length ? contract.PROVENANCE.FALLBACK : null);
  return scaffold;
}

module.exports = { buildCbhScaffold, mergeCbhL3, applyProvenance, headingService };
