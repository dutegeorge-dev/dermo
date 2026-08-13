import type { Dictionary } from "../types.js";

/**
 * English dictionary — full translation of the Russian source (ru.ts).
 * Implements the same Dictionary interface; `tsc --noEmit` verifies
 * structural parity across locales.
 *
 * Left untranslated by design: URLs and asset paths, Lucide icon names,
 * CSS classes and inline HTML markup, proper nouns (Guangzhou, VTB, brand
 * names) and registration identifiers (INN, OGRN, KPP).
 */
const en: Dictionary = {
  nav: {
    services: "Services",
    cases: "Cases",
    blog: "Blog",
    about: "About",
    contacts: "Contacts",
  },
  cta: {
    request: "Submit a request",
    calculate: "Calculate",
    telegram: "Telegram",
    telegramWrite: "Message us on Telegram",
  },
  mega: {
    logistics: {
      title: "Logistics",
      subtitle: "How we ship from China: methods, timelines, documents",
    },
    trade: {
      title: "Trade",
      subtitle: "We find, vet and buy goods in China",
    },
    byMethod: "By method",
    byGoods: "By product",
    byCity: "By city",
    allServices: "View all services",
  },
  method: {
    avto: "Road",
    zhd: "Rail",
    more: "Sea",
    avia: "Air",
  },
  methodFull: {
    avto: "Road freight",
    zhd: "Rail freight",
    more: "Sea freight",
    avia: "Air freight",
  },
  logiExtra: {
    groupTitle: "Additional services",
    customs: "Customs clearance",
    certification: "EAEU technical-regulation certification",
    consolidation: "Consolidated cargo",
  },
  goods: {
    flooring: "Flooring",
    building: "Building materials",
    ceramics: "Ceramics & tiles",
    electronics: "Electronics",
    parts: "Spare parts",
    textile: "Textiles",
    equipment: "Equipment",
  },
  city: {
    moscow: "Moscow",
    spb: "Saint Petersburg",
    ekb: "Yekaterinburg",
    nsk: "Novosibirsk",
    kazan: "Kazan",
    blagoveshchensk: "Blagoveshchensk",
  },
  trade: {
    search: "Product / supplier search",
    purchase: "Turnkey purchasing",
    inspection: "Product / factory inspection",
    quality: "Quality control at the factory",
    samples: "Samples & negotiations",
  },
  lang: {
    ru: "RU",
    en: "EN",
    zh: "中文",
    switch: "Select language",
  },
  content: {
    toc: "Contents",
    orderText: "Don't want to handle it yourself?",
    orderCta: "order it from us",
    relatedArticleTitle: "Related article",
    blogTitle: "Blog",
    blogLead: "Articles on logistics, sourcing and shipping goods from China.",
    casesTitle: "Cases",
    casesLead: "Real projects: the task, the solution and the result.",
    emptyBlog: "Articles coming soon.",
    emptyCases: "Cases coming soon.",
    readMore: "Read",
    prev: "Previous",
    next: "Next",
    moreReading: "More reading",
  },
  home: {
    hero: {
      title: "BARS TLC LLC — a trade and logistics company",
      subtitle:
        "We deliver and source goods from China turnkey. Official shipping with a full set of documents, a team in Guangzhou, and direct work with factories.",
      secondary: "Read cases",
    },
    heroForm: {
      title: "Calculate the cost",
      note: "We'll reply within one business day",
      cargoLabel: "What you're shipping or need to source",
      cargoError: "Please specify the product or task.",
      contactLabel: "Phone or Telegram",
      contactError: "Please enter a valid phone number or Telegram.",
      success: "Request sent! We'll get in touch within one business day.",
    },
    trust: {
      expValue: "18 years",
      expLabel: "of experience working with China",
      teamValue: "Guangzhou",
      teamLabel: "our own team in China",
      volumeValue: "100 tons",
      volumeLabel: "shipped per month",
      whiteValue: "Official",
      whiteLabel: "shipping with a full set of documents",
      bankValue: "VTB",
      bankLabel: "partner bank",
      suppliersValue: "Vetted",
      suppliersLabel: "factories and direct contracts",
    },
    about: {
      title: "Who we are",
      p1: "BARS TLC is a trade and logistics company that handles both of an importer's tasks in one place: finding and buying goods in China and bringing them to Russia legally, with a full set of documents.",
      p2: "Our model is different from ordinary intermediaries. The team is physically based in Guangzhou and works with factories directly — we control the goods on the Chinese side rather than passing your money down a chain of agents. On the Russian side, we take on customs clearance and support the shipment with documents.",
      p3: "This lets the client get the factory price without intermediary markups and official shipping with no risk of additional charges or claims from the tax authorities.",
      link: "More about the company →",
    },
    wings: {
      title: "One company — two directions",
      subtitle:
        "We source goods in China and deliver them to Russia — all in one place.",
      logistics: {
        title: "Logistics",
        desc: "We ship cargo from China by every method — road, rail, sea, air. We take on customs clearance and prepare a full set of documents for every shipment. Official shipping to your warehouse in any city in Russia.",
        cta: "Read about shipping →",
        t1: "By method",
        t2: "By product",
        t3: "By city",
      },
      trade: {
        title: "Trade",
        desc: "We find the product and a vetted supplier, inspect the factory, control quality on the production line and buy turnkey. We'll bring samples, negotiate in Chinese, and protect the deal with a contract.",
        cta: "Read about sourcing from China →",
        t1: "Search",
        t2: "Purchasing",
        t3: "Inspection",
        t4: "Quality control",
      },
    },
    steps: {
      title: "How we work",
      s1: {
        title: "Request",
        text: `You submit a <a href="/kontakty/#raschet" class="font-medium text-cyan-dark underline decoration-cyan/40 underline-offset-2 hover:decoration-cyan">request</a> — a manager gets in touch, clarifies the details and sends a commercial offer.`,
      },
      s2: {
        title: "Contract",
        text: "We sign a contract with a Russian legal entity. Payment to a corporate bank account in rubles.",
      },
      s3: {
        title: "Warehouse in China",
        text: "We receive your cargo at our own warehouse in China.",
      },
      s4: {
        title: "Inspection and labeling",
        text: "We inspect the goods at the warehouse in China and apply labeling per Russian requirements.",
      },
      s5: {
        title: "Documents",
        text: "We prepare a full set of documents for customs clearance.",
      },
      s6: {
        title: "Shipping",
        text: "We load the goods and send them by your chosen shipping method.",
      },
      s7: {
        title: "Customs",
        text: "We clear customs at the border and deliver the cargo.",
      },
      s8: {
        title: "Handover",
        text: "We notify you of arrival and hand over the cargo with a full set of documents.",
      },
    },
    cases: {
      title: "Cases",
      all: "All cases",
      more: "Learn more",
    },
    blog: {
      title: "Blog",
      all: "All articles",
      read: "Read",
    },
    ctaFinal: {
      title: "We'll calculate the cost of shipping or sourcing",
      subtitle:
        "Describe your task — we'll prepare an estimate and a proposal. Quick reply.",
    },
  },
  torgovlya: {
    hero: {
      title: "Sourcing and buying goods in China",
      subtitle:
        "We find the factory, not a middleman. We inspect production, control quality and buy goods directly — with our own team in China. From search to shipment.",
      secondary: "Trade services",
    },
    heroForm: {
      title: "Calculate your purchase",
      note: "We'll reply within one business day",
      cargoLabel: "What you need to source",
      cargoError: "Please specify what you need to source.",
      contactLabel: "Phone or Telegram",
      contactError: "Please enter a valid phone number or Telegram.",
      success: "Request sent! We'll get in touch within one business day.",
    },
    alibaba: {
      title: "Why you overpay on Alibaba",
      p1: "When you open Alibaba and type in a product name, the first pages of results are mostly trading companies, not factories. An intermediary margin — usually 20% to 50% — is already built into the price.",
      p2: "This isn't a scam but a feature of the Chinese market: real manufacturers often don't do marketing and don't promote themselves online. They're found only by those who know where to look and how to vet them.",
      p3: "The difference between the factory price and the intermediary's price on a large batch runs into tens of thousands of dollars. On average, working directly with the factory saves up to 40%.",
      accentValue: "up to 40%",
      accentLabel: "savings when working directly with the factory",
    },
    direct: {
      title: "What it takes to work with a factory directly",
      subtitle:
        "Reaching direct supply requires resources that most companies don't have.",
      p1: {
        title: "Location",
        text: "You need to physically come to the manufacturing cluster, not search remotely.",
      },
      p2: {
        title: "Language",
        text: "Fluent Chinese for negotiations — not through a translator in a chat.",
      },
      p3: {
        title: "Expertise",
        text: "Knowledge of the specifics and the ability to check a factory's legal documents.",
      },
      p4: {
        title: "Reputation",
        text: "A history of relationships that builds trust and priority on orders.",
      },
      closing:
        "We have all of the above: a team in China, the language, expertise and connections. While most Russian companies overpay intermediaries, we give access to primary manufacturing prices.",
    },
    cta1: "Tell us what you plan to buy — we'll find the factory and run the numbers",
    guangzhou: {
      title: "We're where production is",
      p1: "Our office is in Guangzhou, China's main trading center. It's an open venue: you can always come in person, meet the team and discuss cooperation.",
      p2: "But the lowest prices and direct contracts with factories aren't in trading hubs — they're in the industrial provinces. While others stick to the markets of the south, we travel deep into the country.",
      provincesLabel: "We travel to the provinces",
      prov1: "Hebei",
      prov2: "Henan",
      prov3: "Zhejiang",
      prov4: "Shandong",
      benefitsTitle: "What visiting the factory gives you",
      b1: "The primary price with no trading-agent markups",
      b2: "On-site verification of real production capacity",
      b3: "Quality control on the shop floor, not at intermediaries' warehouses",
    },
    fullCycle: {
      title: "What we take on — from search to shipment",
      s1: {
        title: "Finding the manufacturer",
        text: "We look for the factory itself, not a middleman. We check licenses, capacity, export history.",
      },
      s2: {
        title: "Production audit",
        text: "We visit the factory before placing the order: equipment, samples, real capacity.",
      },
      s3: {
        title: "Negotiations in Chinese",
        text: "Price, payment terms, timelines, packaging, labeling — in person, with nothing lost in translation.",
      },
      s4: {
        title: "Production control",
        text: "Interim checks during the process, photos and video at every stage.",
      },
      s5: {
        title: "Packaging and labeling",
        text: "To the requirements of Russian customs, marketplaces and Chestny Znak, including under your own brand (Private Label).",
      },
      s6: {
        title: "Certification",
        text: "For key categories, EAEU technical-regulation certificates are already in place; for the rest, we guide you through the procedure.",
      },
      s7: {
        title: "Pre-shipment inspection",
        text: "Cross-check against the approved sample, verification of completeness and packaging, a final report before dispatch.",
      },
    },
    services: {
      title: "What we take on — from search to shipment",
      intro:
        "This is the full turnkey purchasing cycle. But each service can also be ordered separately — if you've already found a supplier or handle part of the work yourself. Click a service to read more.",
      more: "Learn more",
      allLink: "All services",
    },
    process: {
      title: "How the work is organized",
      s1: {
        title: "Request",
        text: "You describe what you need to buy. We clarify requirements, budget, volume.",
      },
      s2: {
        title: "Factory search",
        text: "We find manufacturers, compare prices and terms, filter out middlemen.",
      },
      s3: {
        title: "Samples",
        text: "We order and bring you samples for approval before the order.",
      },
      s4: {
        title: "Contract and payment",
        text: "We sign a contract with the factory in Chinese with correct wording. The approved sample is fixed in the contract.",
      },
      s5: {
        title: "Production and control",
        text: "We place the order, control production, send photos and video.",
      },
      s6: {
        title: "Inspection",
        text: "We check the finished batch against the sample before shipment.",
      },
      s7: {
        title: "Handover to logistics",
        text: "The goods go to shipping — customs, documents, warehouse in Russia.",
      },
    },
    cta2: "Ready to start — send us your purchase request",
    quality: {
      title: "We take responsibility for quality",
      p1: "Before the order is placed, a sample is always delivered to you in Russia. You personally approve it — it's a physical reference standard, fixed in the contract with the factory. Everything that arrives in the container must match this sample.",
      p2: "If the batch doesn't match the sample — that's not your problem to solve alone with a Chinese factory in Chinese. It's our problem. We work with the factory directly, we have a contract in Chinese with correct wording, and the volume and relationship history that give real leverage.",
      p3: "We don't promise that force majeure never happens. But we guarantee we'll do everything to catch the problem before shipment — not after you receive the container in Russia.",
    },
    separate: {
      title: "Need just part of it? We take on individual tasks",
      intro:
        "You don't have to order the full cycle. If you've already found a supplier or handle part of the work yourself — we'll step in at the right stage.",
      s1: {
        title: "Product buyout",
        text: "You found the supplier yourself — we pay for and buy out the goods from the Chinese side, solving the cross-border payment issue.",
      },
      s2: {
        title: "Quality inspection",
        text: "We'll check the batch before shipment: a factory visit, cross-check against the sample, a photo and video report.",
      },
      s3: {
        title: "Export VAT refund",
        text: "We arrange the export so as to reclaim the Chinese export VAT (export VAT rebate) and lower your purchase cost.",
      },
      s4: {
        title: "Supplier search",
        text: "We'll find the factory and give you a price — without the full purchasing cycle.",
      },
      s5: {
        title: "Factory check",
        text: "A legal check of the Chinese counterparty (licenses, whether it's real, history) before you've paid.",
      },
      s6: {
        title: "Certification",
        text: "We'll obtain EAEU technical-regulation certificates and permits as a standalone service.",
      },
    },
    cta3: "Describe your task — we'll tell you how we can help and what it costs",
    spec: {
      title: "Our specializations",
      subtitle:
        "Categories where we have direct contacts with manufacturers and established routes.",
      flooring: {
        title: "Flooring",
        badge: "25–40% cheaper than a distributor",
        lead: "Linoleum, quartz vinyl (LVT/SPC), parquet, carpet, artificial turf.",
        b1: "Factories on par with European brands — without the markup for the name",
        b2: "EAEU technical-regulation certificates for key items already in place",
        b3: "Direct supply from the factory",
        link: "More about flooring",
      },
      parts: {
        title: "Spare parts and engines for Chinese trucks",
        badge: "Selection by VIN",
        lead: "Sinotruk (HOWO), SHACMAN, FAW, Weichai, Dongfeng, Foton.",
        b1: "Engines, transmission, chassis, brakes, body parts",
        b2: "Selection by VIN and part number",
        b3: "Direct prices, official shipping with documents",
        link: "More about spare parts",
      },
      machines: {
        title: "Lathes and metalworking machines",
        badge: "On request",
        lead: "CNC lathes and milling machines, press brakes, laser cutting.",
        b1: "Equipment selection to fit your task and budget",
        b2: "Factory and equipment check before the order",
        b3: "Support with delivery, documents, certification",
        link: "More about equipment",
      },
    },
    partnership: {
      title: "What it means to work with us long-term",
      p1: "With each successive shipment we know your product better: which quality parameters are critical, which factory to work with and which not, how to plan for seasonality.",
      p2: "Clients who work with us for more than a year usually get: shorter lead times for new shipments (the factory already knows the specification), better terms from factories (volume accumulates), ready certificates for repeat items, and a fast response to new requests — logistics and paperwork are already streamlined.",
      p3: "We're not interested in one-off deals. We're interested in a partnership where you calmly run your business in Russia, and China is our area of responsibility.",
    },
    logistics: {
      title: "Bought the goods? We'll bring them in and clear them",
      text: "Purchasing is half the job. The other half — shipping from China, customs clearance and a full set of documents — is on us. Official shipping by any method to your warehouse.",
      cta: "Read about shipping →",
    },
    contacts: {
      title: "How to reach us",
      text: "We reply within one business day. Write or call however is convenient — in Russia and in China.",
      phoneRuLabel: "Phone in Russia",
      phoneCnLabel: "Phone in China",
      telegramLabel: "Telegram",
      emailLabel: "Email",
    },
    faq: {
      title: "Frequently asked questions",
      q1: {
        q: "Do you sell goods or source them to order?",
        a: "We're not a warehouse. For your request we find the factory, agree terms and buy directly — or take on a specific task (search, inspection, buyout).",
      },
      q2: {
        q: "What's the minimum batch?",
        a: "It depends on the product and the factory — each has its own minimum (MOQ). We'll tell you the real minimum for your item during the estimate.",
      },
      q3: {
        q: "Who pays for samples?",
        a: "Samples are ordered and delivered to you before the order. Sample-cost terms are discussed individually — it depends on the product and the factory.",
      },
      q4: {
        q: "How long does finding a factory take?",
        a: "Usually from a few days to a couple of weeks — it depends on the category and the complexity of requirements. For our core categories (building materials, flooring) it's faster; the factories are already known.",
      },
      q5: {
        q: "Can I order goods under my own brand?",
        a: "Yes. We help with Private Label — packaging and labeling under your brand, and document handling.",
      },
      q6: {
        q: "What is the export VAT refund and how does it work?",
        a: "With a properly arranged export from China, part of the VAT paid there can be reclaimed (export VAT rebate). We arrange the export so this refund lowers your cost. With grey-channel import it's lost.",
      },
      q7: {
        q: "Do you guarantee quality?",
        a: "The reference sample is fixed in the contract with the factory, and the batch is checked against it before shipment. Force majeure can't be ruled out, but we aim to catch the problem in China, not after the container reaches Russia.",
      },
      q8: {
        q: "Can I order only inspection / only buyout?",
        a: "Yes. Any service can be ordered separately — see the 'Services' block. We step in at the right stage; the full cycle isn't required.",
      },
    },
    ctaFinal: {
      title: "Tell us what you need to source in China",
      subtitle:
        "We'll find the factory, calculate the price and propose a solution. We'll reply within one business day.",
      button: "Submit a request",
    },
  },
  a11y: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    toggleServices: "Expand the 'Services' menu",
    mainNav: "Main navigation",
    utilityNav: "Utility bar",
    phoneRu: "Phone in Russia",
    phoneCn: "Phone in China",
    telegram: "Message us on Telegram",
  },
  forms: {
    consentPrefix:
      "By submitting this request, I agree to the processing of my personal data and the ",
    consentLink: "privacy policy",
    consentSuffix: ".",
    consentError: "Please confirm your consent to the processing of personal data.",
    sending: "Sending…",
    sendError: "Could not send the request. Please try again or message us on Telegram.",
  },
  cookie: {
    aria: "Cookie usage notice",
    text: "We use cookies for the website to function and for analytics. By continuing to use the site, you agree to this. Read more in the ",
    link: "Privacy Policy",
    suffix: ".",
    accept: "Accept",
  },
  logistika: {
    meta: {
      title: "Shipping goods from China to Russia — official shipping with documents",
      description:
        "Official shipping from China: sea, rail, road, air. Full customs clearance, import declaration, VAT deductible, certification. Our own team in Guangzhou and a legal entity in Russia. Estimate in 1–2 days.",
    },
    hero: {
      h1: "Shipping goods from China to Russia",
      subtitle:
        "Official shipping with a full set of documents. Sea, rail, road, air. Our own team in China, customs clearance and shipment support from request to handover.",
      ctaPrimary: "Calculate the cost",
      ctaSecondary: "Logistics services",
    },
    methods: {
      title: "Shipping methods from China",
      items: [
        {
          icon: "ship",
          title: "Sea container (FCL)",
          time: "40–55 days",
          desc: "For planned shipments in large batches.",
          url: "/uslugi/dostavka/sposoby/more/",
        },
        {
          icon: "train-front",
          title: "Rail (FCL/LCL)",
          time: "20–30 days",
          desc: "Optimal for most medium-volume goods.",
          url: "/uslugi/dostavka/sposoby/zhd/",
        },
        {
          icon: "truck",
          title: "Road (TIR, FTL/LTL)",
          time: "7–14 days",
          desc: "Fast, but about twice as expensive as rail.",
          url: "/uslugi/dostavka/sposoby/avto/",
        },
        {
          icon: "plane",
          title: "Air",
          time: "7–14 days",
          desc: "Samples, electronics, high-value goods.",
          url: "/uslugi/dostavka/sposoby/avia/",
        },
      ],
      note: "Consolidated cargo (LCL) — from 1 m³.",
    },
    cargo: {
      title: "Cargo or official shipping — what the difference means for your business",
      intro:
        "Many companies ship from China through cargo operators because it's cheaper. That's understandable. But cargo is import without full customs clearance, and the point isn't the moral side of it but the concrete consequences for your business.",
      head: {
        criterion: "Criterion",
        white: "Official shipping",
        cargo: "Cargo",
      },
      rows: [
        {
          criterion: "Customs declaration (import declaration)",
          white:
            "Yes. For every shipment — a copy of the declaration, confirming official import.",
          cargo: "No. The goods were imported without full clearance.",
        },
        {
          criterion: "VAT deductible",
          white:
            "Yes. The VAT paid at customs can be claimed as a deduction — real savings for a business on the general tax regime.",
          cargo:
            "No. VAT wasn't paid — there's nothing to deduct, and you have no documents for the goods.",
        },
        {
          criterion: "Documents for sale in Russia",
          white:
            "A full package: the customs declaration, certificates of conformity, waybills, the VAT invoice.",
          cargo:
            "No documents, or dubious ones. The tax authorities and Rospotrebnadzor see this.",
        },
        {
          criterion: "An audit 3 years later",
          white: "Withstands any audit: all documents are in place, everything is paid.",
          cargo:
            "Risk of fines and additional charges. A 2024 import can turn into a multimillion-ruble demand in 2027.",
        },
      ],
      antiTitle: "How money is most often lost on shipping from China",
      antiCases: [
        {
          title: "Understated the customs value.",
          desc: "The scheme works right up until an audit. A year or two later comes an additional assessment of duty and VAT plus a fine — for an amount many times the 'savings.'",
        },
        {
          title: "Got the HS code wrong.",
          desc: "The cargo gets stuck at customs for weeks while payments are recalculated and documents requested. Demurrage and missed deadlines — at the consignee's expense.",
        },
        {
          title: "Sent a prepayment to an intermediary agent.",
          desc: "The money went to an individual's card or an opaque firm — if something goes wrong there's no one to turn to, and no one controls the cargo.",
        },
      ],
      antiNote:
        "These aren't scare stories but the most common situations — exactly what a well-built official scheme is for.",
    },
    ctaInline1: {
      text: "Not sure which scheme suits your goods? We'll calculate and advise.",
      button: "Calculate",
    },
    safety: {
      title: "How we ensure the shipment is secure",
      subtitle: "Each point is a concrete action, not an abstract promise.",
      items: [
        {
          icon: "clipboard-list",
          title: "We determine the exact HS code before the shipment begins.",
          desc: "The wrong code is the most common cause of fines and delays at customs. We request the description, photos and specifications and select the code in advance. That's why the estimate takes 1–2 days, not an hour.",
        },
        {
          icon: "scale",
          title: "We declare at the actual value.",
          desc: "No understatement. Full payment of duty and VAT. It's more expensive than cargo — but it's the only way that will withstand an audit 3 years later.",
        },
        {
          icon: "file-text",
          title: "We work under a commission agreement.",
          desc: "You see all costs separately: purchase, logistics, customs payments, our commission. It's impossible to inflate or hide anything — every line is backed by a document.",
        },
        {
          icon: "badge-check",
          title: "We prepare the permits in advance.",
          desc: `EAEU technical-regulation certificates, state-registration certificates (SGR), notifications, Chestny Znak — we know what your product needs before shipping. For <a href="/uslugi/dostavka/tovary/napolnye-pokrytiya/" class="link-inline">flooring</a>, for example, our EAEU certificates are already in place. Cargo doesn't get stuck over a missing piece of paper.`,
        },
        {
          icon: "shield-check",
          title: "We don't work with goods that can't be imported legally.",
          desc: "If goods can't be cleared officially, we'll say so honestly rather than invent a workaround.",
        },
        {
          icon: "shield",
          title: "We insure cargo.",
          desc: "Financial protection against unforeseen situations en route.",
        },
      ],
    },
    payment: {
      title: "How money and responsibility are arranged",
      intro:
        "The main risk in working with China is sending a prepayment and losing control. With us, money and responsibility are arranged transparently.",
      items: [
        {
          icon: "building-2",
          title: "A contract with a Russian legal entity.",
          desc: "You work under a contract with a company within the Russian legal framework, not with an anonymous firm abroad.",
        },
        {
          icon: "banknote",
          title: "Payment in rubles to a corporate account.",
          desc: "No transfers to individuals' cards or opaque accounts in China. Payment goes to the company's corporate account.",
        },
        {
          icon: "receipt",
          title: "A commission agreement with a cost breakdown.",
          desc: "Purchase, logistics, customs payments and commission — as separate lines. You see where every ruble goes.",
        },
        {
          icon: "user-check",
          title: "Responsibility isn't diluted.",
          desc: "We receive, ship and clear the cargo ourselves — there's someone to answer for any situation, no 'that's the subcontractor's job.'",
        },
      ],
    },
    cost: {
      title: "You understand what you're paying for before signing the contract",
      intro:
        "Most companies give a final figure. We show the structure: logistics cost, customs duty, VAT, our commission — as separate lines. It's not just honest — it lets you manage the cost of your shipment.",
      structureTitle: "What the cost consists of",
      structure: [
        { icon: "truck", text: "Logistics (route, method, weight/volume)" },
        {
          icon: "landmark",
          text: "Customs duty (depends on the HS code and the value of the goods)",
        },
        { icon: "percent", text: "VAT 20% (refundable if you're a VAT payer)" },
        {
          icon: "badge-check",
          text: "Certification and permits (if required)",
        },
        {
          icon: "calculator",
          text: "Our commission (fixed, stated in the contract)",
        },
      ],
      needTitle: "What's needed for the estimate",
      need: "For the estimate we need: a description of the goods with photos and specifications, the batch value, the departure point in China, the destination in Russia, and the weight and volume. We prepare the estimate in 1–2 business days — because we calculate it manually for your HS code, not hand out an average figure off the top of our head.",
    },
    ctaInline2: {
      text: "Send your cargo details — we'll prepare an estimate in 1–2 days.",
      button: "Calculate",
    },
    notAgent: {
      title:
        "Half of 'logistics companies' are one person working as an agent",
      p1: "There are many companies on the market that call themselves carriers. In reality they're agents who've signed on under large operators and resell their services. They don't control the cargo. When something goes wrong, responsibility is split between three parties — and you end up holding the bag.",
      p2: "BARS has its own operating company in Guangzhou and its own legal entity in Russia. We receive the cargo ourselves, ship it ourselves, clear customs ourselves. No invisible subcontractors in the chain.",
    },
    quote: {
      text: "I've been doing business with China for more than 18 years. In that time I've seen it all: factories that send defects on the third batch, intermediaries posing as manufacturers, cargo schemes that fall apart at the first tax audit. That's exactly why we built a system where every stage — from receiving goods in China to documents in Russia — is closed by our own people. Not agents. Not subcontractors. Ours.",
      author: "Evgeny Fotin",
      role: "director",
      photoAlt: "Photo of the company director",
    },
    audience: {
      title: "Who we work with",
      intro:
        "We work with companies that ship goods from China for business — on a regular or one-off basis.",
      items: [
        {
          icon: "building-2",
          title: "Legal entities only.",
          desc: "We work under a contract with organizations and sole proprietors, with official payment to a corporate account. We don't ship private parcels or single-box deliveries.",
        },
        {
          icon: "package",
          title: "From 1 m³.",
          desc: "We take consolidated cargo from a cubic meter and full containers — from a small batch to planned large-volume shipments.",
        },
        {
          icon: "layers",
          title: "Commercial categories.",
          desc: `<a href="/uslugi/dostavka/tovary/napolnye-pokrytiya/" class="link-inline">Flooring</a>, <a href="/uslugi/dostavka/tovary/zapchasti/" class="link-inline">spare parts</a> and <a href="/uslugi/dostavka/tovary/oborudovanie/" class="link-inline">equipment</a>, <a href="/uslugi/dostavka/tovary/elektronika/" class="link-inline">electronics</a>, <a href="/uslugi/dostavka/tovary/tekstil/" class="link-inline">textiles</a> and other goods that can be imported and cleared legally.`,
        },
      ],
    },
    trade: {
      title: "No team in China? We have one — and we're ready to work for you",
      intro1:
        "Shipping is the final stage. But business with China starts earlier: find the factory, not a middleman. Inspect production before you've paid. Agree the price in Chinese, not through a translator in a chat. Oversee packaging and labeling while the goods are still at the factory.",
      intro2:
        "Our director lives in China and has done business with it for more than 18 years. Our team knows how to tell a real factory from a trading agent that calls itself a factory.",
      servicesTitle: "What we do before shipment",
      services: [
        {
          icon: "factory",
          title: "We find production",
          desc: "The factory itself, not a middleman. We check licenses, capacity, export history.",
        },
        {
          icon: "messages-square",
          title: "We negotiate in Chinese",
          desc: "Price, payment, timelines, packaging, labeling. In person, with nothing lost in translation.",
        },
        {
          icon: "camera",
          title: "We control production",
          desc: "Interim checks, photos and video at every stage. You learn about defects before shipment, not after the container.",
        },
        {
          icon: "package",
          title: "We arrange packaging and labeling",
          desc: "To the requirements of Russian customs, marketplaces and Chestny Znak.",
        },
        {
          icon: "badge-check",
          title: "We handle certification",
          desc: "For key categories, EAEU technical-regulation certificates are already in place; for others we'll guide the procedure.",
        },
        {
          icon: "scan-search",
          title: "Pre-shipment inspection",
          desc: "Comparison against the sample, verification of completeness and packaging, a final report before dispatch.",
        },
      ],
      cta: "Go to the 'Trade' page",
    },
    examples: {
      title: "Real estimates for real goods",
      items: [
        {
          text: "How much does it cost to ship a container of flooring from Guangzhou to Moscow?",
          url: "/uslugi/dostavka/goroda/moskva/",
        },
        {
          text: "Shipping flooring from Foshan: an estimate with customs",
          url: "/uslugi/dostavka/tovary/napolnye-pokrytiya/",
        },
        {
          text: "Consolidated cargo from Yiwu to Yekaterinburg: what's included in the cost",
          url: "/uslugi/dostavka/goroda/ekaterinburg/",
        },
        {
          text: "Air shipping of samples from China for certification",
          url: "/uslugi/dostavka/sposoby/avia/",
        },
      ],
    },
    faq: {
      title: "Frequently asked questions",
      items: [
        {
          q: "How long does shipping from China take?",
          a: `Depends on the <a href="#sposoby" class="link-inline">method</a>: air and road — 7–14 days, rail — 20–30, sea — 40–55. The exact time depends on the route and destination; we'll tell you during the estimate.`,
        },
        {
          q: "How is 'official' shipping different from cargo?",
          a: "Official shipping is formal customs clearance: you get an import declaration, pay duty and VAT (which can be claimed as a deduction), and receive a full set of documents to sell legally. Cargo is import without full clearance, which creates the risk of additional charges and fines on audit.",
        },
        {
          q: "What's the minimum cargo volume?",
          a: `We ship consolidated cargo (LCL) from 1 m³ and <a href="/uslugi/dostavka/sposoby/more/" class="link-inline">full containers (FCL)</a>. For small batches we'll arrange a consolidated shipment.`,
        },
        {
          q: "Does my product need certificates?",
          a: `It depends on the category. Many goods require <a href="/uslugi/dostavka/tovary/napolnye-pokrytiya/" class="link-inline">EAEU technical-regulation certificates</a>, SGR or notifications. We determine the list before shipment and prepare the documents in advance so the cargo doesn't get stuck at customs.`,
        },
        {
          q: "How is the price formed?",
          a: "From separate line items: logistics, customs duty, VAT, certification (if needed) and our fixed commission. All items are visible in the commission agreement.",
        },
        {
          q: "Can VAT be refunded?",
          a: "Yes, if you're a VAT payer on the general tax regime: the VAT paid at customs is claimed as a deduction. This is one of the key advantages of official shipping over cargo.",
        },
        {
          q: "What's needed to get an estimate?",
          a: "A description of the goods with photos and specifications, the batch value, the departure and destination points, and the weight and volume. We prepare the estimate in 1–2 business days.",
        },
        {
          q: "Do you work directly or through subcontractors?",
          a: "Directly. We have our own operating company in Guangzhou and a legal entity in Russia — we receive, ship and clear the cargo ourselves.",
        },
      ],
    },
    contacts: {
      title: "How to reach us",
      text: "We reply within one business day. Write or call however is convenient — in Russia and in China.",
      phoneRuLabel: "Phone in Russia",
      phoneCnLabel: "Phone in China",
      telegramLabel: "Telegram",
      emailLabel: "Email",
    },
    finalCta: {
      title: "We'll calculate the cost of shipping your cargo",
      subtitle:
        "Send your product details — we'll prepare an estimate and a proposal in 1–2 days.",
      button: "Submit a request",
    },
  },
  oKompanii: {
    meta: {
      title: "About the company — BARS TLC: a team in China, official import, documents",
      description:
        "BARS TLC is a trade and logistics company with its own team in Guangzhou. 18 years of personal experience working with China, direct work with factories, official import only with a full set of documents.",
    },
    hero: {
      h1: "About the company",
      subtitle:
        "A trade and logistics company with its own team in China. We find, inspect and buy goods, and bring them to Russia through the official scheme — with a full set of documents.",
    },
    quote: {
      text: "I first came to China in 2008. Since then I've learned to trust my eyes, not my ears: here you have to see everything in person — the factory, the goods, the packaging, the shipment. Too much is lost when you work at a distance and through other people's hands. We used to ship via cargo, like many. Today it's fully official import only, with customs clearance and documents for every shipment. Because it's the only way that withstands an audit and doesn't let the client down.",
      author: "Evgeny Fotin",
      role: "director",
      photoAlt: "Photo of the BARS TLC director",
    },
    who: {
      title: "Who we are",
      p1: "BARS TLC is a trade and logistics company that covers both of an importer's tasks in one place: finding and buying goods in China and bringing them to Russia legally, with a full set of documents.",
      p2: "Our team is physically based in Guangzhou and works with factories directly. We don't pass your money down a chain of agents — we go to the production site ourselves, inspect the goods, control the shipment. On the Russian side we take on customs clearance and support the shipment with documents.",
      p3: "We deliberately gave up grey schemes in favor of fully official import. It's more expensive than cargo, but it's a long-term way of working: without the risk of additional charges, fines or claims from the tax authorities.",
    },
    team: {
      title: "Our team",
      subtitle:
        "Real people who handle your shipment — in China and in Russia.",
      members: [
        { name: "Evgeny Fotin", role: "Director", photoAlt: "Photo of the director" },
        {
          name: "Alina",
          role: "Logistics department",
          photoAlt: "Photo of a logistics department employee",
        },
        {
          name: "Georgy",
          role: "Purchasing department",
          photoAlt: "Photo of a purchasing department employee",
        },
        { name: "Dmitry", role: "Manager", photoAlt: "Photo of a manager" },
        {
          name: "Yuri",
          role: "Customs broker",
          photoAlt: "Photo of a customs broker",
        },
        { name: "Maria", role: "Accounting", photoAlt: "Photo of an accountant" },
      ],
      prevLabel: "Previous employees",
      nextLabel: "Next employees",
    },
    docs: {
      title: "Documents and legality",
      subtitle:
        "We operate officially on both sides of the border — and we're ready to show it.",
      items: [
        {
          icon: "building-2",
          title: "Chinese company",
          desc: "An officially registered legal entity in China with the right to export. Business license (营业执照).",
          scanLabel: "Scan of the business license — to be added",
          docKey: "license",
        },
        {
          icon: "landmark",
          title: "Russian company",
          desc: "The shipment goes through a Russian legal entity — with a contract, invoices and closing documents.",
          scanLabel: "Company details",
          requisites: true,
        },
        // The 'Product certificates' card is temporarily hidden — restore by uncommenting.
        // {
        //   icon: "badge-check",
        //   title: "Product certificates",
        //   desc: "For a number of items (e.g., flooring) EAEU technical-regulation certificates of conformity are in place.",
        //   scanLabel: "Certificate scans — to be added",
        //   docKey: "certificates",
        // },
      ],
      legalNameLabel: "Legal name",
      innLabel: "INN",
      ogrnLabel: "OGRN",
      addressLabel: "Registered address",
    },
    why: {
      title: "Why people work with us",
      items: [
        {
          icon: "map-pin",
          title: "We're physically in China",
          desc: "Not dispatchers over chat — a team on the ground; we go to the factory and check the goods with our own eyes.",
        },
        {
          icon: "factory",
          title: "Direct work with factories",
          desc: "Without a chain of intermediaries and their markup. Factory price and control on the production line.",
        },
        {
          icon: "badge-check",
          title: "Quality control before shipment",
          desc: "A reference sample in the contract and inspection at the factory. We catch defects in China — before the goods leave in the container.",
        },
        {
          icon: "shield-check",
          title: "Official import only",
          desc: "Customs clearance and a full set of documents for every shipment. No grey schemes.",
        },
        {
          icon: "user-check",
          title: "Responsibility isn't diluted",
          desc: "We receive, ship and clear it ourselves — there's someone to answer.",
        },
        {
          icon: "layers",
          title: "Two tasks in one place",
          desc: "Turnkey purchasing and shipping — you don't need to assemble a chain of different contractors.",
        },
      ],
    },
    partners: {
      title: "Partners",
      linkLabel: "Go to website",
      items: [
        {
          name: "VTB",
          desc: "Partner bank — settlements and currency control.",
          logo: "/assets/img/partners/placeholder-logo.svg",
          url: "https://www.vtb.ru/",
        },
        {
          name: "Rossertcentr",
          desc: "Partner for product certification.",
          logo: "/assets/img/partners/placeholder-logo.svg",
          url: "#",
        },
        {
          name: "Fulfillment partner",
          desc: "Goods handling and preparation.",
          logo: "/assets/img/partners/placeholder-logo.svg",
          url: "#",
        },
      ],
    },
    finalCta: {
      title: "Want to see for yourself?",
      subtitle:
        "Come to our office in Guangzhou or submit a request — we'll tell you and run the numbers.",
      button: "Submit a request",
    },
  },
  uslugi: {
    index: {
      title: "Services",
      description:
        "The full cycle of working with China: shipping cargo by every method and turnkey purchasing. Logistics — by method, product and city. Trade — from factory search to shipment.",
      subtitle:
        "The full cycle of working with China — shipping cargo and buying goods.",
    },
    dostavka: {
      title: "Shipping from China",
      description:
        "Shipping cargo from China: road, rail, sea, air. Selection by method, product category and destination city. Official shipping with a full set of documents.",
      subtitle:
        "We'll tailor a scheme to your cargo — by shipping method, product category and destination city.",
    },
    sposobyList: {
      title: "Shipping by method",
      description:
        "Methods of shipping cargo from China: road, rail, sea and air. We'll match the transport to your cargo, timelines and budget.",
      subtitle: "Choose a transport method — we'll advise on timelines and terms for your cargo.",
    },
    tovaryList: {
      title: "Shipping by product",
      description:
        "Cargo categories for shipping from China: flooring, spare parts, ceramics and tiles, electronics, textiles, equipment, building materials.",
      subtitle: "Choose a cargo category — we'll account for certification and clearance specifics.",
    },
    gorodaList: {
      title: "Shipping by city",
      description:
        "Cities for shipping cargo from China: Moscow, Saint Petersburg, Yekaterinburg, Novosibirsk, Kazan. Official shipping to your warehouse.",
      subtitle: "We'll deliver the cargo to your warehouse in major Russian cities.",
    },
    dopUslugiList: {
      title: "Additional services",
      description:
        "Additional logistics services: customs clearance, EAEU technical-regulation certification, shipping of consolidated cargo from China.",
      subtitle: "Services accompanying shipping — clearance, certification, consolidated cargo.",
    },
    dostavkaServices: {
      tamozhnya: {
        metaTitle: "Turnkey customs clearance of goods from China | BARS TLC",
        metaDescription:
          "Official customs clearance of goods from China: HS code selection, duty and VAT calculation, declaration, protection against customs-value adjustment. Team in Guangzhou.",
        hero: {
          title: "Customs clearance of goods from China",
          subtitle:
            "We handle the official import of goods from China — with the correct HS code, payment calculation and declaration — so the cargo leaves customs without delays.",
          photoCaption: "Photo: preparing a declaration / customs terminal",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Customs clearance is the legalization of imported goods: selecting the HS code, calculating and paying duty and VAT, preparing and filing the goods declaration. Without properly cleared customs the cargo won't be released, and clearance errors turn into demurrage, additional charges and customs-value adjustments.",
            "We handle import within the official-import framework: we prepare the documents in advance and check the deal for risks before filing the declaration, so the cargo clears customs predictably rather than 'however it turns out.'",
          ],
        },
        zachem: {
          title: "Why it's needed",
          intro: "Customs errors surface at the worst moment — when the cargo is already at the border:",
          pains: [
            { lead: "The wrong HS code.", text: "The duty rate and the set of required permits depend on the code; an error leads to additional charges and delay." },
            { lead: "Customs-value adjustment (CVA).", text: "If the declared value seems understated to customs, payments are recalculated upward — sometimes substantially." },
            { lead: "Cargo demurrage.", text: "An incomplete or incorrect document package delays release, and demurrage costs money." },
            { lead: "Missing permits.", text: "Without the required certificate or declaration of conformity, the goods won't be released." },
          ],
          closing: "It's cheaper to prepare clearance correctly in advance than to deal with additional charges and demurrage when the cargo is already stuck at the border.",
        },
        kakDelaem: {
          title: "How we clear customs",
          photoCaption: "Photo: preparing a declaration / working with documents",
          steps: [
            { title: "We check the goods and documents", text: "We reconcile the contract, invoice, packing list and accompanying documents — whether everything is there and consistent." },
            { title: "We select the HS code", text: "We determine the code for your goods — it drives the duty rate and document requirements." },
            { title: "We calculate the payments", text: "We compute duty and VAT in advance, so the total import cost is known before filing rather than a surprise." },
            { title: "We check the deal for CVA risk", text: "We assess whether there's a risk of customs-value adjustment and prepare a justification for the declared value." },
            { title: "We prepare and file the declaration", text: "We complete the goods declaration and support the release of the cargo." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "The correct HS code and a payment amount known in advance.",
            "A prepared and filed document package with no gaps.",
            "A deal checked for customs-value adjustment risk.",
            "Cargo released from customs without unnecessary demurrage.",
            "Official clearance the tax and customs authorities have no questions about.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "What is customs-value adjustment and what's the risk?", a: "If customs considers the declared value understated, it recalculates payments upward. We check the deal for this risk in advance and prepare a value justification to reduce the chance of a CVA." },
          { q: "Why does the HS code matter so much?", a: "The duty rate and the list of permits depend on the code. A coding error leads to additional charges, delayed release or a demand for missing documents." },
          { q: "What documents are needed for clearance?", a: "Basically — the contract, invoice and packing list; the set of permits depends on the goods. At the start we check whether everything is in place and what needs to be added." },
          { q: "Do you help with certificates and declarations of conformity?", a: "It's a related task — without the required permit, customs won't release the cargo. We handle permit preparation as a separate service and dovetail it with clearance." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Clear customs without demurrage or additional charges",
          subtitle: "Tell us about the goods — we'll select the HS code, calculate the payments and prepare clearance so the cargo comes out predictably.",
          button: "Submit a request",
        },
      },
      sbornye: {
        metaTitle: "Consolidated cargo from China (LCL/LTL): sea, rail, road | BARS TLC",
        metaDescription:
          "Shipping consolidated cargo from China by sea, rail and road. Consolidation at a warehouse in China, door-to-door delivery in Russia from 1 cubic meter. Guangzhou.",
        hero: {
          title: "Consolidated cargo from China (LCL/LTL)",
          subtitle:
            "We'll bring your batch from China, even a small one, as consolidated cargo — by sea, rail or road, without paying for a whole container.",
          photoCaption: "Photo: consolidation warehouse / loading a groupage container",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Consolidated cargo is when batches from different shippers are consolidated and travel together: by sea and rail it's called LCL, by road — LTL. This lets you bring a small batch without paying for a separate container in full — you pay only for your volume.",
            "It suits one-off and test purchases, marketplace sellers, and anyone whose batch doesn't fill a full container. We take batches from 1 cubic meter: we receive the goods from your supplier, consolidate them at a warehouse in China and deliver to a warehouse in Russia.",
          ],
        },
        vidy: {
          title: "Sea, rail or road",
          intro: "We ship consolidated cargo by all three modes of transport and pick the balance of price and time for your task:",
          items: [
            { lead: "Sea (LCL).", text: "The most economical option for planned shipments when time isn't pressing." },
            { lead: "Rail (LCL).", text: "The middle ground: faster than sea, cheaper than road, with a stable schedule." },
            { lead: "Road (LTL).", text: "The fastest overland option — when the goods are needed urgently." },
          ],
          afterText: "Unlike carriers whose consolidated cargo mostly goes by sea or the sea+rail scheme, with us consolidated shipping is available on all three modes — you choose the one that fits your budget and timeline.",
          closing: "For an urgent batch — road; for a planned one — sea; for a balance — rail; we pick the mode for your task, not for whatever's on hand.",
        },
        kakDelaem: {
          title: "How consolidated shipping works",
          photoCaption: "Photo: cargo consolidation at a warehouse in China",
          steps: [
            { title: "Receiving from the supplier and consolidation", text: "We receive the goods from your supplier (or several) at a warehouse in China and, if needed, store them until dispatch." },
            { title: "Cargo preparation", text: "We check the packaging and labeling and reconcile the accompanying documents — the invoice and packing list." },
            { title: "Loading and dispatch", text: "We consolidate the batch into a groupage container or truck, take a loading photo report and dispatch it by the chosen route." },
            { title: "Arrival and customs", text: "The cargo arrives in Russia; we handle customs clearance as a separate service and dovetail it with consolidated shipping." },
            { title: "Door-to-door delivery", text: "After release we deliver the cargo to your warehouse in the required city." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Delivery of a small batch without paying for a whole container — you pay for your volume, from 1 cubic meter.",
            "A choice of sea, rail or road for your budget and timeline.",
            "Consolidation from different suppliers at one warehouse in China.",
            "A loading photo report.",
            "Door-to-door delivery in Russia and a single contact for the whole route.",
            "Customs clearance dovetailed with delivery — no gaps between stages.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "How is consolidated cargo different from a container?", a: "With consolidated shipping your batch travels together with other shippers' cargo, and you pay only for your volume. A separate container pays off at large volumes; consolidated — when the batch doesn't fill it." },
          { q: "By which modes of transport do you ship consolidated cargo?", a: "All three: by sea and rail (LCL) and by road (LTL). We pick the mode for your balance of price and time." },
          { q: "From what volume do you take a batch?", a: "From 1 cubic meter. We'll discuss smaller volumes too — just tell us what the goods are and where they're going." },
          { q: "Can cargo be collected from several suppliers?", a: "Yes. We receive goods from different suppliers at the consolidation warehouse in China and dispatch them as one batch." },
          { q: "Do you also handle customs clearance of consolidated cargo?", a: "Yes, but it's a separate service — we dovetail customs clearance with consolidated shipping so there are no gaps between stages." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Bring your batch without overpaying for a container",
          subtitle: "Tell us about the goods, volume and timeline — we'll pick the type of consolidated shipping and deliver to your warehouse in Russia.",
          button: "Submit a request",
        },
      },
      avto: {
        metaTitle: "Road shipping of goods from China — TIR and via Blagoveshchensk | BARS TLC",
        metaDescription:
          "The fastest shipping from China by road: 7–13 days to Moscow. Transport by TIR and via the warehouse in Blagoveshchensk, FTL and LTL. Official import from the team in Guangzhou.",
        hero: {
          title: "Road shipping of goods from China",
          subtitle:
            "The fastest way to bring goods from China — from 7 to 13 days to Moscow, by TIR or via the warehouse in Blagoveshchensk, as a full truckload or consolidated cargo.",
          photoCaption: "Photo: truck on an international route / border crossing",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Road shipping is the fastest way to bring cargo from China overland: from 7 to 13 days to Moscow. The price of speed is cost: road transport is usually 2–3 times more expensive than rail. So road is chosen when the goods are needed urgently and speed matters more than saving.",
            "We ship both as full trucks (FTL) and as consolidated cargo (LTL) — a small batch can be sent without paying for the whole truck.",
          ],
        },
        vidy: {
          title: "By TIR or via the warehouse in Blagoveshchensk",
          intro: "We offer two road-shipping routes — chosen for your cargo and task:",
          items: [
            { lead: "Shipping by TIR.", text: "TIR is a system of international road transport under the TIR customs convention: the cargo travels under a single customs document (the TIR carnet) and sealed, without intermediate inspections at borders. This lets the truck drive from China straight to the destination without transloading, saving time and reducing the risk of cargo damage." },
            { lead: "Shipping via the warehouse in Blagoveshchensk.", text: "The cargo reaches our warehouse in Blagoveshchensk by road, and from there goes across Russia via a Russian transport company. This option is convenient for flexible delivery across Russian regions." },
          ],
          afterText: "Both routes are available as a full truck (FTL) and as consolidated cargo (LTL).",
          closing: "TIR is through delivery without transloading, door to door; the route via Blagoveshchensk is a flexible link-up with Russian logistics. We pick based on your cargo and destination.",
          photoCaption: "Photo: TIR paperwork / warehouse in Blagoveshchensk",
        },
        kakDelaem: {
          title: "How road shipping works",
          steps: [
            { title: "We collect the cargo from the supplier", text: "We receive the goods in China and, if needed, consolidate a groupage batch (LTL)." },
            { title: "We check packaging and documents", text: "We reconcile the accompanying documents and the suitability of the packaging for road transport." },
            { title: "We ship by the chosen route", text: "By TIR — a through trip under a single customs document; or to the warehouse in Blagoveshchensk with onward delivery across Russia." },
            { title: "Customs clearance", text: "We handle clearance as a separate service and dovetail it with delivery." },
            { title: "Door-to-door delivery", text: "We deliver the cargo to your warehouse in the required city." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "The fastest overland delivery — from 7 to 13 days to Moscow.",
            "A choice of route: through TIR or a flexible link-up via Blagoveshchensk.",
            "FTL or LTL — a full truck or consolidated cargo for your volume.",
            "Customs clearance dovetailed with delivery and door-to-door delivery in Russia.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "What is TIR?", a: "A system of international road transport under the TIR convention: the cargo travels under a single customs document and seal, without intermediate inspections at borders. The truck goes from China straight to the destination without transloading." },
          { q: "How is shipping via Blagoveshchensk different from TIR?", a: "By TIR the truck runs a through trip to the door. Via Blagoveshchensk the cargo reaches our warehouse, and from there travels across Russia via a Russian transport company — which is more convenient for flexible delivery across regions." },
          { q: "How long does road shipping take and why is it more expensive?", a: "From 7 to 13 days to Moscow — the fastest overland option. The price is usually 2–3 times higher than rail: you pay extra for speed." },
          { q: "Can I send a small batch?", a: "Yes, in LTL format — as consolidated cargo, without paying for a whole truck. A full truck (FTL) is taken for large batches." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "Need it urgently — we ship by road",
          subtitle: "Tell us about the cargo, volume and timeline — we'll pick the route (TIR or via Blagoveshchensk) and deliver door-to-door in Russia.",
          button: "Submit a request",
        },
      },
      zhd: {
        metaTitle: "Rail shipping of goods from China — FCL/LCL | BARS TLC",
        metaDescription:
          "Rail shipping from China — the optimal balance of price and time: 18–30 days. FCL containers and LCL consolidated cargo, 40-foot containers. Official import from the team in Guangzhou.",
        hero: {
          title: "Rail shipping of goods from China",
          subtitle:
            "The optimal balance of price and time — from 18 to 30 days. The main shipping method for most of our shipments: a full container or consolidated cargo.",
          photoCaption: "Photo: container train / terminal",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Rail is the golden mean between the speed of road and the economy of sea: 18 to 30 days at a price noticeably lower than road. The stable schedule of container trains makes timelines predictable.",
            "It's by rail that most of our shipments travel — for a typical batch it's the most balanced option. We ship as a full container (FCL) and as consolidated cargo (LCL); we work with 40-foot containers.",
          ],
        },
        vidy: {
          title: "FCL or LCL",
          items: [
            { lead: "FCL — a full container.", text: "When the batch fills a 40-foot container: the goods travel in your container without other cargo added. More predictable in timelines and integrity." },
            { lead: "LCL — consolidated cargo.", text: "When the batch doesn't fill a container: your volume is consolidated with other shippers' cargo, and you pay only for your part." },
          ],
          afterText: "We work with 40-foot containers — optimal in the ratio of volume to freight cost on rail.",
          closing: "Fill a 40-foot container — we take FCL; a smaller batch — LCL, with no overpayment for empty space.",
        },
        kakDelaem: {
          title: "How rail shipping works",
          steps: [
            { title: "We collect the cargo and consolidate", text: "We receive the goods in China; for LCL we consolidate a groupage batch at the warehouse." },
            { title: "We prepare the cargo and documents", text: "We check the packaging for container transport and reconcile the documents." },
            { title: "Loading and dispatch by train", text: "We load the container and dispatch it by container train on a stable schedule." },
            { title: "Customs clearance", text: "We handle clearance as a separate service and dovetail it with delivery." },
            { title: "Door-to-door delivery", text: "After arrival and release we deliver the cargo to your warehouse." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "The optimal balance of price and time — from 18 to 30 days.",
            "Predictable timelines thanks to the stable train schedule.",
            "FCL or LCL — a full container or a groupage batch for your volume.",
            "Customs clearance dovetailed with delivery and door-to-door delivery in Russia.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "How long does cargo take by rail?", a: "From 18 to 30 days. Slower than road but cheaper, and faster than sea — the optimal balance for most shipments." },
          { q: "What's the difference between FCL and LCL?", a: "FCL — you ship a full container; LCL — your cargo travels in a groupage container with other shippers' cargo, and you pay only for your volume." },
          { q: "Why only 40-foot containers?", a: "On rail a 40-foot container is optimal in the ratio of volume to freight cost, so we work with this format." },
          { q: "Why do you recommend rail by default?", a: "For a typical batch it's the best balance of price and time — that's why most of our shipments go by rail. Urgent — road; large volume without a rush — sea." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "The optimal balance of price and time — rail",
          subtitle: "Tell us about the cargo and volume — we'll pick FCL or LCL and deliver door-to-door in Russia in 18–30 days.",
          button: "Submit a request",
        },
      },
      more: {
        metaTitle: "Sea shipping of goods from China — FCL/LCL, 20 and 40 ft | BARS TLC",
        metaDescription:
          "Sea shipping from China for large batches: the most economical freight, 45–60 days. FCL containers and LCL consolidated cargo, 20- and 40-foot. Official import. Guangzhou.",
        hero: {
          title: "Sea shipping of goods from China",
          subtitle:
            "The most economical way to bring a large batch — from 45 to 60 days. A full container or consolidated cargo, 20- and 40-foot containers.",
          photoCaption: "Photo: container ship / port",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Sea shipping is the cheapest transport method per unit of volume, but also the longest: 45 to 60 days. The choice for large batches and planned shipments where timelines aren't pressing and minimal freight cost matters.",
            "We ship as a full container (FCL) and as consolidated cargo (LCL); both 20- and 40-foot containers are available — for different batch volumes.",
          ],
        },
        vidy: {
          title: "FCL or LCL, 20 or 40 feet",
          items: [
            { lead: "FCL — a full container.", text: "For a large batch: your cargo travels in a separate container. A 20-foot (for a smaller volume or heavy cargo) and a 40-foot (for bulky cargo) are available." },
            { lead: "LCL — consolidated cargo.", text: "For a batch that doesn't fill a container: it's consolidated with other shippers' cargo, and you pay for your volume." },
          ],
          afterText: "We pick a 20- or 40-foot container based on the batch volume and weight: for heavy but compact cargo a 20-foot is often more cost-effective, for bulky cargo — a 40-foot.",
          closing: "A large batch — FCL (20 or 40 feet for weight and volume), a small one — LCL with no overpayment for empty space.",
        },
        kakDelaem: {
          title: "How sea shipping works",
          steps: [
            { title: "We collect the cargo and consolidate", text: "We receive the goods in China; for LCL we consolidate the batch at the warehouse." },
            { title: "We prepare the cargo and documents", text: "We check the packaging for sea transport (moisture, a long journey, transloading) and reconcile the documents." },
            { title: "Loading and dispatch by sea", text: "We load the container and dispatch it from a Chinese port." },
            { title: "Customs clearance", text: "We handle clearance as a separate service and dovetail it with delivery." },
            { title: "Door-to-door delivery", text: "After arrival at the port and release we deliver the cargo to your warehouse." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "The lowest shipping cost per unit of volume.",
            "FCL or LCL and a choice of tonnage — 20 or 40 feet for your batch.",
            "A solution for large and planned shipments.",
            "Customs clearance dovetailed with delivery and door-to-door delivery in Russia.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "How long does cargo take by sea?", a: "From 45 to 60 days — the longest option, but also the cheapest per unit of volume. Suitable when timelines aren't pressing." },
          { q: "When is sea better, and when is rail?", a: "Sea — for large and planned batches where minimal price matters. Faster at an acceptable price — rail; urgent — road." },
          { q: "20 or 40 feet — which to choose?", a: "It depends on weight and volume: for heavy compact cargo a 20-foot is often more cost-effective, for bulky light cargo — a 40-foot. We pick for your batch." },
          { q: "Can I send a small batch by sea?", a: "Yes, in LCL format — as consolidated cargo. But for small volumes rail is often better on timelines: we'll compare for your task." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "A large batch without a rush — we ship by sea",
          subtitle: "Tell us about the cargo and volume — we'll pick the container and format and deliver door-to-door in Russia at the best rate.",
          button: "Submit a request",
        },
      },
      avia: {
        metaTitle: "Air shipping from China — samples and small batches | BARS TLC",
        metaDescription:
          "Air shipping from China for samples for certification and small batches up to a pallet. From 7 days. Official import of samples from the team in Guangzhou.",
        hero: {
          title: "Air shipping of goods from China",
          subtitle:
            "Fast delivery for samples and small batches — from 7 days. Optimal for importing samples for certification and urgent batches up to a pallet.",
          photoCaption: "Photo: air cargo / pallet at the airport",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Air shipping is the fastest way to deliver from China: from 7 days. It's also the most expensive per unit of weight, so air is taken not for bulky batches but where speed is critical and the cargo is small.",
            "Air shipping is most often chosen in two cases: importing product samples for certification and urgent small batches — usually up to a pallet.",
          ],
        },
        vidy: {
          title: "What it's suited for",
          items: [
            { lead: "Samples for certification.", text: "Obtaining permits often requires physical samples from China. Air is the fastest way to bring them in so certification isn't held up. We dovetail this import with the certification service." },
            { lead: "Small urgent batches.", text: "When goods are needed fast and the volume is small — up to a pallet — air delivers in a matter of days where overland routes would take weeks." },
          ],
          closing: "Air is about speed at small volume: a sample for testing or an urgent batch up to a pallet, not a bulky shipment.",
        },
        kakDelaem: {
          title: "How air shipping works",
          steps: [
            { title: "We collect the cargo from the supplier", text: "We receive samples or a batch in China." },
            { title: "We prepare the cargo and documents", text: "We check the packaging for air transport and reconcile the accompanying documents." },
            { title: "We ship by air", text: "We deliver the cargo by plane — the fastest route from China." },
            { title: "Customs clearance", text: "We handle import; for samples for certification we dovetail with the corresponding service." },
            { title: "Door-to-door delivery", text: "After release we deliver the cargo to your warehouse." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "The fastest delivery from China — from 7 days.",
            "A convenient channel for importing samples for certification.",
            "A solution for urgent small batches up to a pallet.",
            "Customs clearance dovetailed with delivery and door-to-door delivery in Russia.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "How long does air shipping take?", a: "From 7 days — the fastest way to deliver from China. Speed comes at a price: per unit of weight, air is more expensive than overland options, so it suits small cargo." },
          { q: "Can I bring samples for certification by air?", a: "Yes, it's one of the main scenarios. Samples for testing need to be imported quickly so certification isn't held up — air is optimal for this. We dovetail the import with the certification service." },
          { q: "What volume can be sent by air?", a: "Usually up to a pallet — small urgent batches and samples. For bulky batches, overland routes or sea are more cost-effective." },
          { q: "How does air differ from road in speed?", a: "Air — from 7 days and for small volumes; road — from 7 to 13 days to Moscow and for larger batches. Air is taken when the volume is small and speed is critical." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "Need it fast and in small quantity — we ship by air",
          subtitle: "Tell us about the cargo or samples — we'll send them by air and deliver door-to-door in Russia from 7 days.",
          button: "Submit a request",
        },
      },
    },
    tovary: {
      napolnye: {
        metaTitle: "Flooring from China wholesale — turnkey supply | BARS TLC",
        metaDescription:
          "We supply flooring from China: linoleum, LVT, SPC, artificial turf, carpet, decking. Vetted factories, private-label production, price in rubles, turnkey.",
        hero: {
          title: "Flooring from China",
          subtitle:
            "We supply flooring from China turnkey — from factory selection to container delivery to your warehouse. Extensive experience in this exact category: vetted suppliers, streamlined logistics, price in rubles known in advance.",
          photoCaption: "Photo: warehouse / rolls of flooring",
        },
        chtoPostavlyaem: {
          title: "What we supply",
          intro: "We have extensive experience supplying all kinds of flooring from China. We understand the technical specs of each type and know which factories give the best quality in their category. We supply:",
          products: [
            { name: "Linoleum", photoCaption: "Photo: linoleum" },
            { name: "LVT (vinyl tile)", photoCaption: "Photo: LVT — vinyl tile", linkLabel: "Read the case: turnkey supply of LVT tile from China", linkUrl: "/kejsy/postavka-lvt-plitki/" },
            { name: "SPC (stone-polymer tile)", photoCaption: "Photo: SPC — stone-polymer tile" },
            { name: "Artificial turf", photoCaption: "Photo: artificial turf" },
            { name: "Carpet", photoCaption: "Photo: carpet" },
            { name: "Decking (WPC)", photoCaption: "Photo: decking (WPC)" },
          ],
        },
        otlichieList: {
          title: "Why us for flooring",
          items: [
            { lead: "Vetted factories and contracts.", text: "For flooring we already have established partnerships with factories, signed contracts and proven shipments — it's not an experiment with a new supplier but a well-worn path." },
            { lead: "A large list of suppliers and the best prices.", text: "We keep a wide pool of factories, constantly monitor the market and understand pricing — we find favorable terms, not the first offer." },
            { lead: "We understand the technical specs.", text: "We know the difference between coating types, wear classes and backings — we help pick what fits your task, not 'whatever's available.'" },
            { lead: "Production under your brand.", text: "We can arrange flooring production under your brand — with your own specification, packaging and design (OEM)." },
            { lead: "The final price in rubles in advance.", text: "We calculate the total shipment cost in rubles — including goods, logistics and clearance — so you know the final price before you start, rather than assembling it from pieces. We share our market insight." },
          ],
          closing: "With flooring you get not a 'search from scratch' but a ready, streamlined chain: vetted factories, a clear price in rubles and experience in this exact category.",
        },
        kakDostavlyaem: {
          title: "How we deliver",
          intro: "All flooring is cost-effective to ship from China exclusively by rail in a full container (FCL). The reason is simple: flooring is bulky, heavy cargo, and splitting it into groupage batches or using other transport modes isn't cost-effective — the per-unit shipping cost rises sharply. A full container by rail gives the best balance of price and time for exactly this category.",
          intro2: "We dovetail delivery with customs clearance and deliver to your warehouse.",
          closing: "For flooring there's one optimum — rail in a full container; that keeps delivery cost-effective and the per-unit price minimal.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Flooring selected for your task, of the right type and quality.",
            "A vetted factory with a streamlined supply, not a random supplier.",
            "The option of production under your own brand.",
            "The final shipment price in rubles, known in advance.",
            "Container delivery by rail with clearance dovetailed — to your warehouse.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "What flooring do you ship from China?", a: "Linoleum, LVT, SPC, artificial turf, carpet, decking (WPC) and more. For each type we understand the specs and know the specialized factories." },
          { q: "Can you make flooring under our brand?", a: "Yes, we can arrange production under your brand — with your specification, packaging and design." },
          { q: "Which method is more cost-effective for shipping flooring?", a: "Rail in a full container (FCL). It's bulky, heavy cargo — splitting it into groupage batches or using other modes isn't cost-effective, the per-unit price rises sharply." },
          { q: "Can you name the final price right away?", a: "Yes, we calculate the total shipment cost in rubles including goods, logistics and clearance — so you know the final price in advance. Submit a request describing the goods and volume." },
          { q: "Can you help pick a supplier if I don't know exactly what I need?", a: "Yes. We understand coating types and specs and pick for your task — both price and quality depend on it." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "We'll supply flooring from China turnkey",
          subtitle: "Tell us which coating and what volume you need — we'll pick the factory, calculate the price in rubles and bring it by container to your warehouse.",
          button: "Submit a request",
        },
      },
      zapchasti: {
        metaTitle: "Spare parts for Chinese trucks and machinery from China | BARS TLC",
        metaDescription:
          "Supply of spare parts and engines for Chinese trucks and machinery: HOWO, SHACMAN, FAW, Weichai, Sitrak, Dongfeng, Foton. Original and aftermarket, selection by VIN, official shipping.",
        hero: {
          title: "Spare parts for Chinese trucks and machinery",
          subtitle:
            "We supply spare parts and engines for Chinese trucks and machinery turnkey — original and aftermarket, selection by VIN, direct prices and official shipping with documents. Team in China.",
          photoCaption: "Photo: spare-parts warehouse / assembled engine",
        },
        chtoPostavlyaem: {
          title: "What we supply",
          intro: "We supply spare parts and engines for Chinese trucks and machinery — for equipment from the same manufacturers. We work with the main brands:",
          brands: "Sinotruk (HOWO), SHACMAN, FAW, Weichai, Sitrak, Shanxi, Dongfeng, Foton.",
          detailCategories: {
            label: "Part categories",
            items: [
              "Engines and attachments",
              "Transmission",
              "Chassis",
              "Braking system",
              "Body parts",
            ],
          },
          outro: "We can quickly process any number of items — even assemble a whole vehicle part by part. We select parts by VIN and part number — exactly the one you need, no guessing.",
        },
        kategorii: {
          title: "Three quality tiers",
          columns: { category: "Tier", what: "What it is", when: "When to choose it" },
          rows: [
            { category: "Original", what: "The brand's factory original parts", when: "When you need maximum service life and guaranteed compatibility" },
            { category: "Aftermarket for the European market", what: "Higher-quality aftermarket parts designed for European-market requirements", when: "A balance of price and quality" },
            { category: "Aftermarket for the Chinese market", what: "Aftermarket parts for China's domestic market, the most budget option", when: "When minimal price matters most" },
          ],
          closing: "We don't push 'original only' or slip you a cheap aftermarket part passed off as original — we honestly offer three tiers so you decide the balance of price and service life yourself.",
        },
        dvigateli: {
          title: "Assembled engines",
          intro: "We supply new and used contract engines, assembled. Used engines are remanufactured, with original attachments: this isn't 'pulled from a wreck as-is' but a remanufactured complete unit. We select them for your equipment model.",
          closing: "A contract engine from us is remanufactured and complete, with original attachments, not a pig in a poke from a salvage yard.",
        },
        otlichieList: {
          title: "Why us",
          items: [
            { lead: "Direct prices.", text: "We work with suppliers in China directly — no extra middlemen in the price." },
            { lead: "Selection by VIN and part number.", text: "We find exactly the right part for your equipment, not a 'similar' one." },
            { lead: "Official shipping with documents.", text: "Parts arrive legally, with a full set of documents — no problems at customs or in accounting." },
            { lead: "Any number of items.", text: "We process large item lists — from a single part to a full kit for assembling a whole vehicle." },
            { lead: "Production under your brand.", text: "We can arrange the production of spare parts under your brand (OEM)." },
          ],
          closing: "From a single part by VIN to a full kit for assembly — with a direct price and official documents.",
        },
        kakDostavlyaem: {
          title: "How we deliver",
          intro: "For spare parts we tailor delivery flexibly, to your urgency and volume:",
          items: [
            { lead: "FCL (full container)", text: "— for large batches of parts." },
            { lead: "LCL (consolidated cargo)", text: "— for medium volumes, without paying for a whole container." },
            { lead: "Air on a special flight", text: "— even a single urgent part: when the equipment is idle and the part is needed immediately." },
          ],
          intro2: "We dovetail delivery with customs clearance and deliver to your warehouse.",
          closing: "From a single part by air in a couple of days to a container of parts by rail — a method to match your urgency.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Spare parts and engines for your equipment, of the right brand and quality tier.",
            "Precise selection by VIN and part number.",
            "A choice between original and aftermarket — for your budget.",
            "Remanufactured contract engines, assembled, with original attachments.",
            "Official shipping with documents by a method to match your urgency.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "For which makes do you supply spare parts?", a: "Sinotruk (HOWO), SHACMAN, FAW, Weichai, Sitrak, Shanxi, Dongfeng, Foton — trucks and machinery from these manufacturers." },
          { q: "How do the three quality tiers differ?", a: "Original — factory parts with maximum service life. Aftermarket for the European market — higher quality, a balance of price and service life. Aftermarket for the Chinese market — the most budget option. You choose for your task and budget." },
          { q: "What does a used contract engine mean?", a: "It's a remanufactured assembled engine with original attachments — not pulled from a wreck 'as-is,' but a complete unit brought back to working order." },
          { q: "Can I order a single part?", a: "Yes. We process any volume — from a single part (we can bring it urgently by air) to a large list of items for assembling a whole vehicle." },
          { q: "How do you select a part?", a: "By VIN and part number — this gives an exact match to your equipment, with no risk of getting a 'similar but wrong' one." },
          { q: "Does delivery come with documents?", a: "Yes, delivery is official, with a full set of documents — no problems at customs or when registering/booking it." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        caseLink: "Read the spare-parts case",
        cta: {
          title: "We'll find and bring the parts for your equipment",
          subtitle: "Send the VIN or a list of items — we'll select the parts, offer original or aftermarket and bring them by official shipping with documents.",
          button: "Submit a request",
        },
      },
      elektronika: {
        metaTitle: "Electronics from China turnkey — supply and private label | BARS TLC",
        metaDescription:
          "We supply electronics from China to order: from fitness bands to gaming monitors. Private-label production, certification, official import. No grey parallel imports.",
        hero: {
          title: "Electronics from China",
          subtitle:
            "We supply electronics from China to your request — from a fitness band to a gaming monitor. We'll get to grips with any category, arrange private-label production and help with certification. Official import only.",
          photoCaption: "Photo: electronics / gadget production",
        },
        chtoPostavlyaem: {
          title: "What we supply",
          intro: "We'll get to grips with any electronics to your request — from a small gadget to a complex device. We supply a wide range of categories:",
          products: [
            { name: "Wearable electronics", photoCaption: "Photo: fitness bands, smartwatches, trackers" },
            { name: "Monitors and displays", photoCaption: "Photo: monitors and displays, including gaming" },
            { name: "Computer peripherals", photoCaption: "Photo: keyboards, mice, headsets, accessories" },
            { name: "Consumer electronics", photoCaption: "Photo: small appliances, home gadgets" },
            { name: "Audio", photoCaption: "Photo: headphones, speakers, acoustics" },
            { name: "Accessories and components", photoCaption: "Photo: chargers, cables, power banks, cases" },
          ],
        },
        extraSections: [
          {
            id: "bez-parallelnogo",
            title: "We work officially, without parallel imports",
            intro: "We supply electronics that can be imported legally: unbranded products and goods under the client's own brand. We do NOT work with third-party brands through parallel (grey) imports — it's a deliberate choice in favor of the official scheme.",
            intro2: "What this gives you: the goods arrive with a full set of documents and certificates, and can be sold, registered and listed on marketplaces with peace of mind — without the risks that grey import of third-party brands carries.",
            closing: "We don't haul third-party brands via grey schemes — we bring electronics you legally sell under your own brand or unbranded, with official documents.",
          },
          {
            id: "oem",
            title: "Production under your brand",
            intro: "We can arrange the production of electronics under your brand (OEM): product selection to your specification, your logo, packaging and design. This lets you enter the market with your own brand rather than reselling someone else's.",
          },
          {
            id: "sertifikaciya",
            title: "Electronics certification",
            intro: "Almost all electronics are subject to mandatory certification for import and sale in Russia (technical regulations on safety and electromagnetic compatibility; for devices with radio modules — additional requirements). We take this on: we obtain the permits for your product and dovetail them with the supply.",
            closing: "Electronics almost always can't just be imported and sold without a certificate — we close certification right away, so the goods are legal from day one.",
          },
        ],
        kakDostavlyaem: {
          title: "How we deliver",
          intro: "Electronics are compact but often urgent and expensive, so we tailor delivery flexibly to volume and urgency:",
          items: [
            { lead: "Air", text: "— for samples, urgent and small batches: fast, when the goods are needed for a sales launch." },
            { lead: "Rail / road", text: "— for regular batches: a balance of price and time." },
            { lead: "FCL / LCL", text: "— a full container for a large volume or consolidated cargo for a medium batch." },
          ],
          intro2: "We dovetail delivery with customs clearance and certification and deliver to your warehouse.",
          closing: "An urgent batch for a launch — air, a planned volume — overland; we pick the method for your task.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Electronics selected to your request, in the right category.",
            "The option of private-label production (OEM).",
            "Completed certification — the goods are legal for sale and marketplaces.",
            "Official import with a full set of documents, without the risks of grey import.",
            "Delivery by a method to match your urgency — to your warehouse.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "What electronics do you ship?", a: "A wide range to order: wearables, monitors, peripherals, consumer electronics, audio, accessories and components. We'll get to grips with any category for your task." },
          { q: "Do you ship Apple, Samsung and other brands?", a: "No. We don't work with third-party brands through parallel (grey) imports — it's a deliberate choice in favor of the official scheme. We supply unbranded electronics and goods under your own brand." },
          { q: "Can you make electronics under our brand?", a: "Yes, we can arrange production under your brand (OEM) — with a specification, logo and packaging tailored to you." },
          { q: "Do electronics need certification?", a: "Almost always yes — for import and sale in Russia. We obtain the permits for your product and dovetail them with the supply." },
          { q: "By which method do you ship electronics?", a: "Flexibly, to urgency and volume: air for urgent and small batches, rail/road and container (FCL/LCL) for regular and large ones. We pick for the task." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "We'll bring electronics from China turnkey",
          subtitle: "Tell us what electronics you need — we'll select to your request, handle certification and bring it by official shipping with documents.",
          button: "Submit a request",
        },
      },
      tekstil: {
        metaTitle: "Clothing manufacturing in China under your brand — textiles | BARS TLC",
        metaDescription:
          "Clothing manufacturing in China under your brand: children's, sportswear, casual, underwear, outerwear. Specialized factories, fabric and trim selection, certification and labeling.",
        hero: {
          title: "Textiles and clothing manufacturing in China under your brand",
          subtitle:
            "We produce clothing in China under your brand — from children's to outerwear. We pick a specialized factory for the right type, fabric and trim, and handle certification and labeling. Extensive experience in contract manufacturing.",
          photoCaption: "Photo: garment production / finished clothing",
        },
        chtoPostavlyaem: {
          id: "chto-shyem",
          title: "What we make",
          intro: "We have extensive experience producing various clothing under the client's own brand. We produce by category:",
          products: [
            { name: "Children's clothing", photoCaption: "Photo: children's clothing" },
            { name: "Sportswear", photoCaption: "Photo: sportswear" },
            { name: "Women's casual", photoCaption: "Photo: women's casual clothing" },
            { name: "Men's casual", photoCaption: "Photo: men's casual clothing" },
            { name: "Underwear", photoCaption: "Photo: underwear" },
            { name: "Outerwear", photoCaption: "Photo: outerwear" },
          ],
          outro: "Each type has its own specialized factory. China has many factories specializing in one specific kind of clothing: a factory that has sewn only outerwear for years will make it better than a generalist. We pick the factory for your type of garment rather than sewing everything in one place 'however it turns out.'",
        },
        extraSections: [
          {
            id: "pod-brend",
            title: "Manufacturing under your brand",
            intro: "We arrange contract manufacturing under your brand: you come with an idea or a sample, and we take it to a finished garment under your brand. The work includes:",
            items: [
              { lead: "Selecting a specialized factory", text: "for your type of clothing." },
              { lead: "Producing the fabric", text: "to the required composition, density and properties." },
              { lead: "Selecting trim", text: "— zippers, buttons, labels, packaging." },
              { lead: "Producing the batch", text: "under your brand with the required sewing quality." },
            ],
            closing: "You get a finished line under your own brand — from fabric and trim to a produced batch — rather than reselling someone else's range.",
          },
          {
            id: "sertifikaciya-markirovka",
            title: "Certification and labeling",
            intro: "Clothing is subject to mandatory certification (declaration under EAEU technical regulations — with stricter requirements for children's clothing) and labeling. We take this on:",
            items: [
              { lead: "Certification", text: "— we obtain the permits for your products." },
              { lead: "Labeling", text: "— we apply the accompanying labeling (composition, size, EAEU tags) and Chestny Znak codes (as the importer you obtain the codes in the CRPT system; we apply them to the garments in China; we don't handle CRPT registration)." },
            ],
            closing: "Clothing can't just be brought in and sold without a certificate and labeling — we close this right away, so the batch is legal and ready for sale.",
          },
        ],
        kakDostavlyaem: {
          title: "How we deliver",
          intro: "We ship the finished batch of clothing as a full container (FCL) for a large run or as consolidated cargo (LCL) for a small batch — you pay only for your volume.",
          intro2: "We dovetail delivery with customs clearance, certification and labeling and deliver to your warehouse.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "A finished clothing line under your brand.",
            "A specialized factory for the right type of garment.",
            "Fabric and trim selected to your specification.",
            "Completed certification and labeling — the batch is legal and ready for sale.",
            "FCL/LCL delivery for your volume — to your warehouse.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "Do you sew clothing under our brand?", a: "Yes, it's the core service. We arrange contract manufacturing under your brand: we select the factory, fabric and trim and produce the batch under your brand." },
          { q: "What clothing can you produce?", a: "Children's, sportswear, women's and men's casual, underwear, outerwear. For each type we pick a specialized factory." },
          { q: "Why does a specialized factory matter?", a: "China has many factories specializing in one kind of clothing. A specialized factory that has sewn only its type for years makes it better than an 'all-in-one' generalist." },
          { q: "Do you do certification and labeling?", a: "Yes. We obtain certification under EAEU technical regulations and apply labeling, including Chestny Znak codes (you obtain the codes in CRPT as the importer, we apply them in China)." },
          { q: "By which method do you deliver?", a: "As a full container (FCL) for a large run or as consolidated cargo (LCL) for a small batch. We dovetail delivery with certification and labeling." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "We'll produce your clothing line in China turnkey",
          subtitle: "Tell us what you want to produce — we'll pick the factory, fabric and trim, handle certification and labeling and bring the batch to your warehouse.",
          button: "Submit a request",
        },
      },
      oborudovanie: {
        metaTitle: "Equipment and machines from China — turnkey supply | BARS TLC",
        metaDescription:
          "We supply machines and industrial equipment from China: analogs of European and Soviet metalworking machines, packaging and food lines. Official import with documents.",
        hero: {
          title: "Equipment and machines from China",
          subtitle:
            "We supply machines and industrial equipment from China to your request — from analogs of European and Soviet metalworking machines to packaging and food lines. Official import with a full set of documents.",
          photoCaption: "Photo: machine / production line",
        },
        chtoPostavlyaem: {
          title: "What we supply",
          intro: "We supply industrial equipment and machines from China for a specific task. The range is wide — we select to your request, including non-standard equipment:",
          products: [
            { name: "Metalworking machines", photoCaption: "Photo: lathes, milling machines, press brakes" },
            { name: "Packaging equipment", photoCaption: "Photo: filling, packaging, labeling" },
            { name: "Food equipment", photoCaption: "Photo: lines and machines for food production" },
            { name: "Other industrial equipment", photoCaption: "Photo: industrial equipment to order" },
          ],
          outro: "If the equipment you need isn't on the list — write to us, we'll most likely find and bring it: Chinese manufacturers make machinery for almost any industry.",
        },
        extraSections: [
          {
            id: "analogi",
            title: "Analogs of European and Soviet machines",
            intro: "A separate area is analogs of European and Soviet metalworking machines. When the original European equipment is hard to get or expensive, Chinese manufacturers offer analogs capable of replacing it in function and specs. We help pick such an analog for your task and parameters — and bring it in legally.",
            closing: "Where the familiar European machine has become unavailable or too expensive, a Chinese analog often covers the same task — we'll help pick and bring it in officially.",
          },
          {
            id: "postavka",
            title: "Turnkey supply — what's included",
            intro: "We handle exactly the supply of equipment: selection for the task, supplier and production verification, buyout, official import with documents and delivery to your warehouse. Since equipment is an expensive and complex purchase, it's especially important to check it before shipment: for that we have factory checks, inspection and production control (separate services, dovetailed with the supply).",
            closing: "A machine is an expensive purchase, and here a check before payment and before shipment especially pays off: better to be sure of the equipment on-site than to sort it out once it's in Russia.",
          },
        ],
        kakDostavlyaem: {
          title: "How we deliver",
          intro: "Equipment is heavy and often oversized cargo, so we ship it by rail or sea in a container — this is optimal in cost for such weight and dimensions.",
          intro2: "We dovetail delivery with customs clearance and deliver to your warehouse.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Equipment selected for your task, including analogs of European and Soviet machines.",
            "Supplier and equipment verification before shipment (as separate services).",
            "Official import with a full set of documents.",
            "Delivery by rail or sea with clearance dovetailed — to your warehouse.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "What equipment do you ship?", a: "Metalworking machines, packaging and food equipment, other production lines — we select to your request, including non-standard." },
          { q: "Can you find an analog of a European machine?", a: "Yes, it's a separate area. When European equipment is unavailable or expensive, we pick a Chinese analog for your task and specs and bring it in legally." },
          { q: "Do you do commissioning and servicing?", a: "We handle equipment supply: selection, verification, official import and delivery. We don't do commissioning or servicing." },
          { q: "How can I be sure the equipment is of good quality?", a: "Equipment is an expensive purchase, so we recommend a factory check and inspection before shipment — these are separate services we dovetail with the supply." },
          { q: "By which method do you deliver equipment?", a: "By rail or sea in a container — this is optimal for heavy, oversized cargo. We dovetail it with customs clearance." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: { label: "Need the full cycle?", text: "Turnkey purchasing: from factory search to shipment and delivery to Russia." },
        cta: {
          title: "We'll select and bring equipment from China",
          subtitle: "Tell us what equipment or machine analog you need — we'll select for the task, verify and bring it by official shipping with documents.",
          button: "Submit a request",
        },
      },
    },
    torgovlya: {
      title: "Trade services",
      description:
        "Sourcing services in China: supplier search, production audit and control, negotiations, inspection, packaging and labeling, certification, product buyout, VAT refund, factory check.",
      subtitle:
        "From factory search to shipment — each service can be ordered separately.",
      services: {
        search: "Supplier search",
        audit: "Production audit",
        negotiations: "Negotiations",
        control: "Production control",
        inspection: "Inspection",
        packaging: "Packaging and labeling",
        certification: "Certification",
        buyout: "Product buyout",
        vat: "Export VAT refund",
        factoryCheck: "Factory check",
      },
      poisk: {
        metaTitle: "Turnkey supplier search in China — vetting and comparison | BARS TLC",
        metaDescription:
          "We'll find 10–15 suppliers for your product, compare prices and specs, check export licenses and acceptance of payment from Russia, and bring samples. Team in Guangzhou.",
        hero: {
          title: "Supplier search in China",
          subtitle:
            "We contact 10–15 factories for your product at once, compare prices and specs, check documents and real samples — you pick the best of the vetted, not the first one you come across.",
          photoCaption: "Photo: the BARS team negotiating at a factory in Guangzhou",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "You tell us what product you need — we find those who actually make or supply it and bring them to a comparable form: prices, specs, terms, documents. In the end you get not one 'somehow' contact but a shortlist of several vetted suppliers with clear differences between them.",
            "The key distinction of our approach: we don't stop at one or two options. For a single product we reach out to 10–15 suppliers at once. This gives a real sample for comparison — by price, quality, minimum order, timelines and willingness to work with payment from Russia. One supplier gives you nothing to compare; fifteen give a picture of the market.",
            "We work directly with manufacturers and suppliers — we have our own team in Guangzhou, so vetting happens on-site, not by chat from Moscow.",
          ],
        },
        zachem: {
          title: "Why it's needed",
          intro: "Going into the Chinese market on your own usually runs into several typical problems:",
          pains: [
            {
              lead: "It's unclear who you're dealing with.",
              text: "On Alibaba and 1688, factories, trading companies and resellers stand side by side. The reseller's price is higher and the accountability lower.",
            },
            {
              lead: "Nothing to compare against.",
              text: "You found one supplier — but whether that's expensive or cheap, normal quality or not, there's nothing to judge by.",
            },
            {
              lead: "Payment may not go through.",
              text: "The supplier is ready to sell but can't accept money from Russia — no suitable account, the bank doesn't work with Russia. The deal stalls right after the price is agreed.",
            },
            {
              lead: "A sample 'in a photo' and a sample 'in hand' are different things.",
              text: "A catalog photo doesn't show the real quality of the material, assembly or packaging.",
            },
          ],
          closing: "We close all four points before you transfer any money.",
        },
        komuPodhodit: {
          title: "Who it's for",
          text: "The service is for importers who buy commercial batches in China and want to reach a real factory, not a reseller. We work with different product categories:",
          categories: [
            "flooring",
            "spare parts and engines for Chinese trucks",
            "metalworking machines",
            "building materials",
            "electronics",
            "textiles",
            "other commercial categories",
          ],
          note: "If your category isn't on the list — write to us, we can most likely handle it too.",
        },
        kakDelaem: {
          title: "How we do it",
          photoCaption: "Photo: comparing product samples on a table",
          steps: [
            {
              title: "We clarify the product and requirements",
              text: "What exactly is needed, which specs are critical, what volume, for which market. This sets the search parameters.",
            },
            {
              title: "We reach out to 10–15 suppliers",
              text: "We search through our channels, specialized platforms (1688, Alibaba), wholesale markets and factories in the relevant provinces. We contact them in parallel, not one by one.",
            },
            {
              title: "We request full information on each",
              text: "By a single checklist, to compare later:",
              items: [
                "product specs and configuration;",
                "price, minimum order, production timelines;",
                "the export license and documents for the goods;",
                "which banks the supplier can accept payment from Russia through;",
                "sample terms.",
              ],
            },
            {
              title: "We compare and filter",
              text: "We put everyone into a comparable table — it's clear who's actually cheaper at equal specs, who has the needed documents, who solves the payment issue. Resellers and unsuitable ones are filtered out.",
            },
            {
              title: "We request and compare samples in person",
              text: "We get samples from the shortlisted suppliers and evaluate them physically — not by photo. The team in Guangzhou examines the material, assembly and quality in hand.",
            },
            {
              title: "We hand you the shortlist",
              text: "You get vetted suppliers with clear differences and our assessment — and choose who to work with.",
            },
          ],
        },
        sravnenie: {
          title: "Three ways to find a supplier — and the difference",
          columns: {
            self: "Yourself",
            agent: "Through an intermediary agent",
            bars: "Through BARS",
          },
          rows: [
            {
              criterion: "How many suppliers you'll compare",
              self: "1–2, whoever you found",
              agent: "depends on the agent",
              bars: "10–15 in parallel",
            },
            {
              criterion: "On-site verification",
              self: "no, by chat",
              agent: "rarely",
              bars: "yes, team in Guangzhou",
            },
            {
              criterion: "Checking acceptance of payment from Russia",
              self: "found out too late",
              agent: "not always",
              bars: "before the deal starts",
            },
            {
              criterion: "Samples in person",
              self: "hard to arrange",
              agent: "sometimes",
              bars: "yes, we compare physically",
            },
            {
              criterion: "Filtering out resellers",
              self: "hard to tell apart",
              agent: "the agent may be a middleman itself",
              bars: "we filter them out",
            },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "A shortlist of several vetted suppliers for your product — not one contact, but a choice.",
            "A comparison by price, specs, minimum order and timelines in a comparable form.",
            "Confirmed presence of the needed documents and export license.",
            "An understanding of which banks payment from Russia will go through — before the deal starts, not after.",
            "An assessment of the real samples in person by our team on-site.",
          ],
          closing: "And most importantly — you enter the deal already knowing the market for your product, not blind.",
        },
        faqTitle: "Frequently asked questions",
        faq: [
          {
            q: "How much does supplier search cost?",
            a: "It depends on the category and the complexity of the task. We calculate it individually — submit a request with a description of the product.",
          },
          {
            q: "How long does the search take?",
            a: "From a few days. For our core categories (flooring, spare parts) it's faster, the factories are already known.",
          },
          {
            q: "What do you need from me to start?",
            a: "A description of the product and key requirements: specs, volume, a price reference, for which market. The more precise the input, the more precise the selection. We take on the rest.",
          },
          {
            q: "Do you check that it's a factory and not a reseller?",
            a: "Yes. When comparing suppliers we filter out middlemen — they have higher prices and lower accountability. We work to get you to a direct manufacturer or a reliable supplier.",
          },
          {
            q: "Why check in advance which banks the supplier accepts payment through?",
            a: "Because the deal can stall exactly on payment: the supplier agreed the price but can't accept money from Russia. We find this out at the information-gathering stage so we don't waste time on those with whom settlement is impossible.",
          },
          {
            q: "Can I get samples before ordering a batch?",
            a: "Yes, it's part of the service. We request samples from the shortlisted suppliers and evaluate them in person — the material, assembly, quality — not just by a catalog photo.",
          },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        caseLink: "Read the case: how we searched for a monitor manufacturer",
        cta: {
          title: "We'll find you a supplier you won't have to vet all over again",
          subtitle: "Describe the product — we'll select and vet 10–15 suppliers, compare them and bring samples. You choose from the vetted ones.",
          button: "Submit a request",
        },
      },
      vykup: {
        metaTitle: "Product buyout in China for official import into Russia | BARS TLC",
        metaDescription:
          "We officially buy out goods from your Chinese supplier under a commission agreement for official import: payment through our company or VTB Shanghai with a minimal commission. Team in Guangzhou.",
        hero: {
          title: "Product buyout in China",
          subtitle:
            "We officially buy out goods from your supplier so the deal goes through the official way — with no questions from customs or the tax authorities on import into Russia.",
          photoCaption: "Photo: payment and deal documents, warehouse in Guangzhou",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Product buyout is the payment and legal formalization of a purchase from a Chinese supplier so that the cargo has correct export and payment documents. We pay the supplier and structure the deal for official import: so that at every stage — from the money transfer to customs clearance in Russia — you have clean, mutually consistent documents.",
            "It sounds like a simple 'transfer the money' operation, but this is exactly where the legality of the whole shipment most often breaks. If the buyout is done incorrectly — no export declaration, payment went 'in the black,' the documents don't match — problems surface at customs and with the tax authorities in Russia when the goods are already en route. We structure the buyout so that this doesn't happen.",
          ],
        },
        zachem: {
          title: "Why a correct buyout is needed",
          intro: "An incorrectly formalized buyout hits the client after the money is gone and the goods have left:",
          pains: [
            {
              lead: "Customs problems.",
              text: "Without a correct export declaration and a matching invoice/packing list, the cargo gets stuck in clearance or falls under value adjustment.",
            },
            {
              lead: "Tax problems.",
              text: "A 'grey' payment with no clear basis creates risks on audit: it's unclear what the money was for and where the goods came from.",
            },
            {
              lead: "The supplier can't export on its own.",
              text: "Many factories have no export license of their own — they sell only within China. Without solving this, legal export is impossible.",
            },
            {
              lead: "Losses on transfer fees.",
              text: "With a suboptimal payment route, fees eat up a noticeable share of the amount.",
            },
          ],
          closing: "A correct buyout isn't 'transfer the money' but formalizing the deal so it's clean all the way from the Chinese factory to your warehouse in Russia.",
        },
        kakDelaem: {
          title: "How we formalize the buyout",
          intro: `We work under a <strong>commission agreement</strong>: we buy out the goods using the client's funds, acting legally as the commission agent. We don't force everyone into one scheme — we look at what the supplier has and choose a workable payment option:`,
          photoCaption: "Photo: negotiations with the supplier / issuing an invoice",
          steps: [
            {
              title: "Payment directly to the supplier's bank",
              text: "If the supplier has an export license and an account that accepts payment from Russia — we do the buyout straight to it. The simplest path, when the supplier already knows how to work for export.",
            },
            {
              title: "Buyout through our Chinese company",
              text: "If the supplier has no export license (it sells only within China) — we buy out the goods to our company in China and handle the export ourselves. This way the goods legally leave China even if the supplier can't export itself.",
            },
            {
              title: "Help opening an account at VTB Shanghai",
              text: "We're VTB partners and can help the supplier open an account at VTB Shanghai. This allows payment from Russia with a minimal transfer fee — useful when the work with this supplier will be regular, not one-off.",
            },
          ],
          outro: "Which method fits — we determine by whether the supplier has an export license, which banks it's ready to accept payment through and how regular the shipments will be.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Officially bought-out goods with correct export documents for official import.",
            "Payment made legally under a commission agreement, with a clear basis — with no risks for the tax authorities.",
            "The export issue solved, even if the supplier has no license of its own.",
            "A minimal transfer fee when paying through VTB Shanghai.",
            "A deal that won't fall apart at customs or on a tax audit.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          {
            q: "What happens if the buyout is done incorrectly?",
            a: "Problems surface after payment and dispatch: the cargo may get stuck at customs over an incorrect export declaration, and the tax authorities will have questions about the 'grey' payment. A correct buyout removes both risks in advance.",
          },
          {
            q: "What if the supplier has no export license?",
            a: "It's a common situation — many factories sell only within China. In that case we buy out the goods to our Chinese company and handle the export ourselves, so the export is legal.",
          },
          {
            q: "Whose money is the buyout made with?",
            a: "We work under a commission agreement: we buy out the goods with your funds, acting as the commission agent. It's legally transparent — the payment basis is clear and the deal is officially formalized.",
          },
          {
            q: "Why is payment through VTB Shanghai more advantageous?",
            a: "We're VTB partners and can help the supplier open an account there. This cuts the transfer fee to minimal values — especially noticeable with regular shipments to the same supplier.",
          },
          {
            q: "How much does the buyout service cost?",
            a: "The commission is from 3.9%; the exact amount is calculated individually — it depends on the deal amount, the payment method and the regularity of shipments. Submit a request for an estimate.",
          },
          {
            q: "Is the buyout a separate service or part of a full supply?",
            a: "Both. The buyout is a key stage of official import, usually paired with delivery and customs clearance, but it can also be ordered separately — if you handle logistics yourself.",
          },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "We'll buy out the goods so the deal is clean from the factory to your warehouse",
          subtitle: "Tell us about the goods and supplier — we'll pick the buyout method, handle the export and make the payment with a minimal fee.",
          button: "Submit a request",
        },
      },
      proverka: {
        metaTitle: "Factory check in China with a site visit — supplier audit | BARS TLC",
        metaDescription:
          "We personally visit the factory in China before the order: we verify real production, a photo report from the line, the export license and accounts for official import. Team in Guangzhou.",
        hero: {
          title: "Factory check in China",
          subtitle:
            "We visit the production site in person before you place the order — we verify whether it's a real factory and whether it's suitable for official import into Russia.",
          photoCaption: "Photo: production line / our employee at the factory",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "A factory check is a visit by our employee to the supplier before the order is placed, to make sure that behind the nice website and catalog stands a real production, not an office with a couple of managers. We come to the address, look at the line with our own eyes, take a photo report and deliver a verdict on the supplier's reliability.",
            "Most competitors offer a remote check — by documents and photo requests 'without leaving Moscow.' We work differently: we have a team in Guangzhou, and we physically go to the factory. Often it's exactly on-site that a 'factory' turns out to be a reseller trading company with no production of its own. From photos and chat, you can't see this.",
          ],
        },
        zachem: {
          title: "Why check the factory before the order",
          intro: "Checking the goods after manufacturing is fine, but late: the money is already with the supplier. A check before the order removes risks that would otherwise surface when changing anything is already expensive:",
          pains: [
            {
              lead: "The 'factory' turns out to be a reseller.",
              text: "At the address — an office with a few staff, while the production is someone else's or doesn't exist at all. Higher price, lower accountability, quality control impossible.",
            },
            {
              lead: "Production can't handle your volume or quality.",
              text: "There's a line, but the capacity and equipment don't match what was promised verbally.",
            },
            {
              lead: "The factory isn't suitable for official import.",
              text: "No export license, can't accept payment from Russia, document problems — and the legal shipment falls through after the prepayment.",
            },
            {
              lead: "The supplier is unreliable as a company.",
              text: "Problems with the business license, registration, bank accounts — things visible only on a check, not from a catalog.",
            },
          ],
          closing: "It's cheaper to find out the factory isn't who it claims to be before the money transfer — not after, when the goods are already paid for.",
        },
        kakDelaem: {
          title: "How we check the factory",
          photoCaption: "Photo: shop-floor inspection / negotiations with the supplier at the factory",
          steps: [
            {
              title: "Preliminary document check",
              text: "Before the visit we check the company through open sources and China's state registers: business license, registration, charter capital, legal representative, real line of business.",
            },
            {
              title: "In-person visit to production",
              text: "Our employee goes to the factory and looks at the line live — whether it's real production or a showcase office.",
            },
            {
              title: "Photo report from the production line",
              text: "We photograph the shop floor, equipment, products, warehouse — you get visual confirmation, not words.",
            },
            {
              title: "Tough questions — face to face",
              text: "On-site we ask the supplier direct questions they usually dodge in chat: real capacity, timelines, who owns the production, how they handle export.",
            },
            {
              title: "Suitability check for official import",
              text: "Separately we check what's critical for a legal shipment to Russia: whether there's an export license, which banks payment from Russia goes through, whether the documents and accounts are in order.",
            },
            {
              title: "Reliability verdict",
              text: "We bring it all into a conclusion: whether it's a real factory, whether you can work with it, whether it's suitable for official import — and help place and agree the order while personally on-site.",
            },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "A clear answer: real production or a reseller.",
            "A photo report from the production line — visual confirmation of capacity.",
            "A verdict on the supplier's reliability as a company (license, registration, accounts).",
            "Confirmation that the factory is suitable for official import (export license, payment from Russia).",
            "An order placed and agreed with our employee personally present on-site.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          {
            q: "Why is a factory visit better than a remote check?",
            a: "Remotely you see only what the supplier is willing to show. On-site it's immediately clear whether it's real production or a showcase office with no line of its own — from photos and chat you often can't tell.",
          },
          {
            q: "Why check the factory before the order rather than the goods after?",
            a: "Checking the goods after manufacturing is also needed, but by then the money is already with the supplier. A visit before the order removes the risk of running into a reseller or a factory unsuitable for official import while you haven't paid anything yet.",
          },
          {
            q: "What's included in the photo report?",
            a: "Footage of the shop floor, equipment, products and warehouse — what confirms the factory's real capacity and goes into the reliability conclusion.",
          },
          {
            q: "Do you check whether the factory is suitable for official import?",
            a: "Yes. Separately we look at the export license, which banks payment from Russia goes through and the state of the documents — without this, a legal shipment can fall through after the prepayment.",
          },
          {
            q: "Can you help place the order right away?",
            a: "Yes. While at the factory, we help agree and formalize the order — specs, terms and arrangements are fixed on-site.",
          },
          {
            q: "How much does the check cost and how long does it take?",
            a: "The cost depends on the factory's distance from Guangzhou — the farther the visit, the higher the price; we calculate individually for the specific address. Timelines — from 1 day after agreement. Submit a request with the supplier's address for a precise estimate.",
          },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Find out whether it's a real factory before you transfer any money",
          subtitle: "Give us the supplier's contacts — we'll visit the production, check it live and send a photo report with a verdict.",
          button: "Submit a request",
        },
      },
      vozvrat: {
        metaTitle: "Export VAT refund in China on product buyout | BARS TLC",
        metaDescription:
          "We buy out goods to our Chinese company with no deal commission and refund you part of the export VAT taken as a deduction. Honest about timelines and risks. Guangzhou.",
        hero: {
          title: "Export VAT refund in China",
          subtitle:
            "We buy out the goods to our Chinese company — with no commission for handling the deal — and refund you part of the export VAT that can be taken as a deduction.",
          photoCaption: "Photo: documents and VAT invoices, office in Guangzhou",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "When goods are bought within China, Chinese VAT is already built into the price. On export the state refunds this tax — but only a Chinese exporting company that bought out the goods with correct documents and filed an export declaration can obtain the refund. A foreign company can't reclaim it directly.",
            "We buy out your goods to our Chinese company and handle the export ourselves. This is needed in any case if the supplier has no export license of its own. But here begins the difference between us and most companies on the market.",
          ],
        },
        otlichie: {
          title: "Where we differ",
          intro: "When another company buys out goods to its Chinese firm, one of two things usually happens — and both times not in your favor:",
          theirPains: [
            {
              lead: "They charge a commission for handling the deal",
              text: "through their company — meaning you pay extra just for the fact that the buyout goes to their legal entity.",
            },
            {
              lead: "They keep the VAT refund for themselves.",
              text: "The refund is received by the Chinese exporting company (i.e., them), and often this amount is simply not shown to the client or handed over — it stays their hidden margin.",
            },
          ],
          oursIntro: "We do the opposite:",
          oursPoints: [
            {
              lead: "We don't charge a commission",
              text: "for handling the deal through our Chinese company.",
            },
            {
              lead: "We refund you your share of the VAT",
              text: "that we manage to take as a deduction on your shipment.",
            },
          ],
          closing: "Where an ordinary intermediary earns on you twice — with a commission and withheld VAT — we return that money to you.",
        },
        kakDelaem: {
          title: "How it works",
          photoCaption: "Photo: preparing the export declaration / calculation",
          steps: [
            {
              title: "We buy out the goods to our Chinese company",
              text: "With the correct documents, without which a refund is impossible.",
            },
            {
              title: "We file the export declaration",
              text: "The goods legally leave China to our exporting company — that's the basis for the refund.",
            },
            {
              title: "We file for the VAT refund",
              text: "The Chinese tax authorities review the application and confirm the export.",
            },
            {
              title: "We refund you your share",
              text: "Once the refund reaches us, we pass you your share of the VAT taken as a deduction on your deal.",
            },
          ],
        },
        ogovorki: {
          title: "Important caveats",
          intro: "A VAT refund is real money, but not instant and not guaranteed. To avoid false expectations, we say it plainly:",
          points: [
            {
              lead: "Timelines.",
              text: "The refund takes 3 to 6 months. It's not a top-up to the deal here and now, but money that comes later.",
            },
            {
              lead: "Refusal is possible.",
              text: "The Chinese authorities may refuse a refund on a specific shipment. If that happens — we send you the official response from the tax authorities confirming the refusal. So you can see the VAT didn't 'settle' with us but genuinely wasn't refunded.",
            },
          ],
          closing: "We don't promise a guaranteed refund — we promise honesty: we'll return your share if the refund goes through, and document it if it's refused.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Buyout of the goods to our Chinese company with no commission for handling the deal.",
            "A refund of your share of the export VAT taken as a deduction on the shipment.",
            "A legally formalized export — suitable for official import into Russia.",
            "Transparency: in case of refusal — official confirmation from the Chinese authorities.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          {
            q: "How much VAT can be refunded?",
            a: "The refund rate in China reaches up to 13% depending on the product category, but the actual amount depends on the shipment and how much can be taken as a deduction. We calculate your share for the specific product individually — submit a request for an estimate.",
          },
          {
            q: "Why do others charge a commission and you don't?",
            a: "Many intermediaries earn on the very fact of handling the deal through their Chinese company and often keep the VAT refund for themselves. We don't charge a commission for handling and we return your share of the VAT.",
          },
          {
            q: "How long to wait for the refund?",
            a: "From 3 to 6 months. It's money that comes after the export is confirmed and reviewed by the tax authorities, not right away at the deal.",
          },
          {
            q: "And if the refund is refused?",
            a: "It's possible — the decision is made by the Chinese authorities. In case of refusal we send you the official response confirming the refund didn't go through, so it's clear the VAT didn't stay with us.",
          },
          {
            q: "Can VAT be refunded if the supplier has no export license?",
            a: "Yes — that's exactly why we buy out the goods to our exporting company, handling the export ourselves.",
          },
          {
            q: "Is the VAT refund a separate service or part of the buyout?",
            a: "It's part of buying out the goods to our Chinese company: the same mechanism, but with a refund of your VAT share instead of a deal commission.",
          },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Find out how much VAT you can reclaim on your shipment",
          subtitle: "Tell us about the goods and supplier — we'll calculate the possible refund and do the buyout with no deal commission.",
          button: "Submit a request",
        },
      },
      kontrol: {
        metaTitle: "Production control of goods in China — quality and timelines | BARS TLC",
        metaDescription:
          "We control the production of your goods in China: we enforce quality and timelines, take interim samples, and push with a personal visit in tough cases. Guangzhou.",
        hero: {
          title: "Production control in China",
          subtitle:
            "We control how the manufacturer makes your goods — and enforce quality and timelines, rather than just recording problems after the fact.",
          photoCaption: "Photo: our employee on the line during production",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Production control is the supervision of your order's manufacturing at the factory from launch to completion. We make sure the goods are made as agreed: in quality, specification and timelines. And most importantly — we don't just observe, we enforce the manufacturer's compliance with the arrangements.",
            "That's the distinction of our approach. Most companies offer inspection as observation: come, take samples, write a report, hand it to you. It's useful but passive — you learn of the problem but solve it yourself. We work more actively: if the factory deviates from quality or slips the timelines, we step in and steer the order back on track.",
          ],
        },
        zachem: {
          title: "Why control production",
          intro: "If you don't control production, the typical problems surface only at shipment or already in Russia — when it's too late to fix:",
          pains: [
            {
              lead: "Quality drifted from what was agreed.",
              text: "Material, assembly, color, configuration differ from the approved sample — and the batch is already made.",
            },
            {
              lead: "Timelines slip.",
              text: "The factory drags, puts your order at the back of the queue, feeds you promises — while your shipment is on fire.",
            },
            {
              lead: "The mismatch is noticed too late.",
              text: "Without an interim check, defects are found on the finished batch, when redoing means losing money and time.",
            },
          ],
          closing: "The earlier you catch a deviation, the cheaper it is to fix — mid-production it's an edit, on a finished batch it's a loss.",
        },
        kakDelaem: {
          title: "How we control production",
          photoCaption: "Photo: checking the sample against the specification at the production site",
          steps: [
            {
              title: "We control quality during production",
              text: "We reconcile what the factory is actually making with the agreed specification and approved sample — not only at the finish.",
            },
            {
              title: "We enforce the timelines",
              text: "We keep the factory on schedule: we track the stages, don't let your order be pushed back and flag early if something goes wrong.",
            },
            {
              title: "We take interim samples",
              text: "We get samples from the manufacturer during production — to see the result at a stage when it can still be corrected, not on the finished batch.",
            },
            {
              title: "We push when the factory doesn't deliver",
              text: "In hard cases we advance the order with a personal visit and have the uncomfortable conversation with the supplier face to face — what chat can't solve. The team in Guangzhou makes it possible to come to the factory, not push with letters from another country.",
            },
          ],
          outro: "It was exactly an interim check that once let us uncover a mismatch in part of a batch by order and color and prevent a loss of more than $7,000 for the client —",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Goods made to the agreed quality and specification — not 'however it turned out.'",
            "Timelines met under our pressure, not on the factory's word of honor.",
            "Interim samples — a chance to catch a deviation while it can still be fixed.",
            "On-site intervention in hard cases — a personal visit and a direct talk with the supplier.",
            "Prevented losses from defects that would otherwise surface already in Russia.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          {
            q: "How is this different from a regular quality inspection?",
            a: "A regular inspection records the state and gives a report — you go solve the problem yourself. We not only spot the deviation but enforce the factory's fix, up to a personal visit and a direct talk.",
          },
          {
            q: "When is control done — at the start, middle or end?",
            a: "During production, not only on the finished batch. An interim check is exactly for catching a deviation at a stage when it can still be corrected without redoing the whole batch.",
          },
          {
            q: "What does 'interim samples' mean?",
            a: "These are samples we get from the factory during manufacturing. They show the real result in advance — you can see whether the color, material and specification hold, before it's too late.",
          },
          {
            q: "What do you do if the factory slips timelines or quality?",
            a: "In light cases we keep it on schedule and push remotely. In hard ones — we go to the factory in person and have the uncomfortable conversation with the supplier on-site: it works where chat no longer helps.",
          },
          {
            q: "Is this the same service as a factory check?",
            a: "No. A factory check is before the order (whether it's a real manufacturer). Production control is during the manufacturing of an already-placed order.",
          },
          {
            q: "Is production control a one-off check or ongoing supervision?",
            a: "It's supervision of the whole order from launch to completion. If you need a one-off check of a batch before shipment — that's a separate service, inspection.",
          },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        caseLink: "Read the case",
        cta: {
          title: "Don't wait for the finished batch to learn about defects",
          subtitle: "Tell us about the order and the factory — we'll put production under control, take interim samples and enforce quality and timelines.",
          button: "Submit a request",
        },
      },
      inspekciya: {
        metaTitle: "Product inspection in China — batch check against specs | BARS TLC",
        metaDescription:
          "We visit the factory in any province of China, check the batch against your specs, provide a photo report and help negotiate rework of defects. Team in Guangzhou.",
        hero: {
          title: "Product inspection in China",
          subtitle:
            "We visit the factory in any province of China and check the finished batch against your technical specification — before the goods leave for Russia.",
          photoCaption: "Photo: inspector checking the batch at the factory warehouse",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Inspection is an independent check of your batch at the factory before shipment. Our employee visits the production site, reconciles the goods with your technical specification and sample, records everything on photo and video and issues a conclusion: the batch meets the requirements or not.",
            "We check where the goods are — we visit the factory in any province of China. The team in Guangzhou goes to the inspection itself, without subcontracting it to outsiders, so you get an assessment from someone who answers for the result.",
          ],
        },
        zachem: {
          title: "Why inspection is needed",
          intro: "Without inspection, defects surface at the warehouse in Russia, when arguing with the factory is late and expensive:",
          pains: [
            { lead: "The batch doesn't match the specs.", text: "Dimensions, material, color, configuration differ from what was agreed." },
            { lead: "Photos are of the best samples, the batch is worse.", text: "The perfect unit goes to the photo shoot, while the boxes get goods with defects." },
            { lead: "Wrong quantity and mix-ups.", text: "The batch has the wrong quantity or mixed-up models and article numbers." },
            { lead: "Packaging and labeling problems.", text: "Packaging and labeling defects surface already at customs or at acceptance." },
          ],
          closing: "It's cheaper to check the batch at the factory, while there's leverage over the supplier, than to receive faulty goods at your warehouse and prove something at a distance.",
        },
        kakDelaem: {
          title: "How the inspection works",
          photoCaption: "Photo: reconciling the item with the specs, taking a sample",
          steps: [
            { title: "We agree the specs and checklist", text: "We take your technical specification and, if needed, add points for the product's specifics — what exactly to check and by which criteria." },
            { title: "We visit the factory", text: "The employee goes to the supplier's production or warehouse in the relevant province and checks the batch on-site — at any moment: when the batch is fully ready or during container loading." },
            { title: "We check by sampling", text: "We take samples from the batch by the acceptance-sampling standard (AQL) and check appearance, dimensions, configuration, functionality, packaging and labeling — against the agreed checklist." },
            { title: "We give a photo and video report with a conclusion", text: "You get a report with photos and an assessment for each criterion and see the goods through our inspector's eyes. The bottom line — a verdict: the batch passes or not." },
            { title: "We help negotiate in case of defects", text: "If mismatches are found, the report becomes an argument in the talk with the factory — we help negotiate rework of the batch, fixing defects or another solution in your favor." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "An objective assessment of the batch against your specs — before shipment, not after receipt.",
            "A photo and video report with a conformity conclusion.",
            "Confirmed quantity, configuration, packaging and labeling.",
            "An argument and support in negotiations with the factory if defects are found.",
            "A decision made on facts: ship, rework or reject the batch.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "In which provinces of China do you conduct inspection?", a: "We visit the factory in any province of China. The team is based in Guangzhou and goes to the check itself, without subcontracting to outsiders." },
          { q: "What is an AQL check?", a: "AQL is an international acceptance-sampling standard: it determines how many units of the batch to check to reliably detect defects without examining every single piece. We check the batch exactly by sampling, not 'looked at a couple of boxes.'" },
          { q: "What do you do if defects are found in the batch?", a: "We record the mismatches in the report and help negotiate with the factory to rework the batch, fix defects at the factory's expense or another solution. A report with photos is a weighty argument in such a talk." },
          { q: "When should the inspection be done?", a: "At any moment for your task: when the batch is fully ready before shipment or during container loading. A check at the factory matters while the goods are still there and there's leverage over the supplier." },
          { q: "What do you need from me to start?", a: "A technical specification for the product and the supplier's contacts. The more detailed the specs, the more precise the check; we'll add missing points from experience with your product type." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Check the batch while it's still at the factory",
          subtitle: "Send the specs and the supplier's contacts — we'll visit the factory, check the batch by sampling and give a report with a conclusion.",
          button: "Submit a request",
        },
      },
      audit: {
        metaTitle: "Supplier audit in China — remote online check | BARS TLC",
        metaDescription:
          "We remotely check a Chinese supplier: documents, registers, financial reliability, video call with production, a report. Team in Guangzhou.",
        hero: {
          title: "Supplier audit in China",
          subtitle:
            "We check the reliability of a Chinese supplier remotely — by documents, registers and video call — without a visit and faster than an on-site inspection.",
          photoCaption: "Photo: working with registers and documents, a video call with the factory",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "A supplier audit is a check of the counterparty without visiting the factory: through open sources, China's state registers, company documents and a video call with production. It suits situations where you need to quickly assess a counterparty's reliability before starting work, while a factory visit is still excessive.",
            "The check is run by our team in China: access to Chinese registers and the language let us see what an outsider foreigner can't — the real registration, licenses and litigation history of the company.",
          ],
        },
        chtoProveryaem: {
          title: "What we check",
          items: [
            { lead: "Registration and legality.", text: "Date and number of registration, legal representative, charter capital, active licenses — whether the company exists and does what it claims." },
            { lead: "Financial reliability.", text: "Signs of stability, how well the company matches its declared scale." },
            { lead: "Litigation history.", text: "The presence of ongoing lawsuits and disputes in China." },
            { lead: "Foreign-trade activity.", text: "Data on export volumes and sales markets — whether the supplier really works for export." },
            { lead: "Video call with production.", text: "By arrangement — a video stream or video call with the line, warehouse and premises." },
          ],
          closing: "The audit closes documentary and financial risks — what's visible from papers and registers.",
        },
        kakDelaem: {
          title: "How the audit works",
          steps: [
            { title: "We clarify the supplier and your questions", text: "We take the company data and a list of what matters to find out specifically for you." },
            { title: "We check registers and open sources", text: "We verify registration, licenses, litigation history, export activity." },
            { title: "We contact the supplier and, with consent, go to video", text: "We ask the supplier your questions and, by arrangement, hold a video call with production." },
            { title: "We prepare a report", text: "We bring the results into a report with a risk assessment and a conclusion on the advisability of cooperation." },
          ],
        },
        kogda: {
          title: "When an audit is enough, and when a visit is needed",
          intro: "Honestly about the method's scope: a remote audit reliably reveals documentary and financial risks and is often enough for trading companies. But remotely you can't fully assess real production capacity and operational processes — a video call shows only what the supplier is willing to show.",
          closing: `If you work with a manufacturer and a large order is at stake, an audit is the first filter, not a substitute for a visit. When the documents are in order and it makes sense to go further, it's safer to add an <a href="/uslugi/torgovlya/proverka-zavoda/" class="font-medium text-cyan-dark">on-site factory check →</a>`,
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "How is an audit different from a factory visit?", a: "Remotely we check documents, registers, finances and litigation history, but we see production only by video call. A visit lets us assess real capacity live. An audit is a fast first filter; a visit — for manufacturers and large orders." },
          { q: "When is an audit enough?", a: "Often — when working with a trading company or for an initial screening of unreliable counterparties by documents and finances. To assess real production, a visit is recommended." },
          { q: "Can production be seen online?", a: "Yes, by arrangement with the supplier a video stream or video call with the line and warehouses is possible. But this shows only what the supplier is willing to show." },
          { q: "What will I get as a result?", a: "A report with a check of registration, licenses, litigation history and export activity and a conclusion on the supplier's reliability." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Check the supplier without visiting the factory",
          subtitle: "Give us the company data — we'll check the registers and documents, go to a video call and give a reliability report.",
          button: "Submit a request",
        },
      },
      peregovory: {
        metaTitle: "Negotiations with a supplier in China — we lead them for you | BARS TLC",
        metaDescription:
          "We negotiate with a Chinese supplier for you: in Chinese, by your plan, remotely or on-site. We secure terms, prices and resolution of disputes.",
        hero: {
          title: "Negotiations with a supplier in China",
          subtitle:
            "We negotiate with a Chinese supplier for you — in their language, by your plan — to secure the terms you need without a language or cultural barrier.",
          photoCaption: "Photo: negotiations / a call with the supplier",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "This is a service where our representative in China takes on negotiations with a Chinese supplier: discussing price, terms, timelines, product modifications or disputed issues — by a plan agreed with you — and passing you the result. It suits situations where you have specific questions for the supplier but lack the resource, language or standing to push them through yourself.",
            "Negotiations are led by a native speaker from our team in China. For the Chinese side, a conversation with a local representative is a different level of trust and an entirely different result than chatting with a foreigner through a translator.",
          ],
        },
        sChem: {
          title: "What we help with",
          items: [
            { lead: "Securing terms and price.", text: "A discount by volume, payment terms, timelines — where you need to bargain, not just ask." },
            { lead: "Agreeing product modifications.", text: "Changes to your requirements, applying your brand, adjusting the specification." },
            { lead: "Resolving a dispute.", text: "Slipped timelines, quality claims, short shipments — when the supplier dodges answers in chat." },
            { lead: "Removing the language and cultural barrier.", text: "Eliminating the misunderstandings that break arrangements and erode trust between the parties." },
          ],
          closing: "Negotiating with a Chinese counterpart is positional bargaining; the result depends heavily on who leads it and in what language.",
        },
        kakDelaem: {
          title: "How we negotiate",
          photoCaption: "Photo: the representative negotiating with the supplier",
          steps: [
            { title: "We agree the negotiation plan", text: "We go through your situation, goals and limits, and fix what to achieve and which questions to ask." },
            { title: "We negotiate with the supplier", text: "Our representative holds the conversation in Chinese — remotely (call/video) or with a factory visit if the matter requires personal presence." },
            { title: "We pass you the result", text: "We bring the arrangements and the supplier's answers into a clear report and agree the next step with you." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Negotiations conducted in the supplier's language and by your plan.",
            "Secured terms: price, timelines, modifications or resolution of a dispute.",
            "The language and cultural barrier removed — with no losses to misunderstanding.",
            "A clear report on the arrangements and a recommendation for the next step.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "Are negotiations conducted remotely or on-site?", a: "Both. Most issues are resolved remotely — by call or video. If the situation requires personal presence, our representative visits the factory." },
          { q: "Do you negotiate in Chinese?", a: "Yes. The conversation is led by a native speaker from our team in China — for the Chinese side this means higher trust and a better result than dealing with a foreigner through a translator." },
          { q: "Can you help if the supplier slips timelines or sent defects?", a: "Yes, it's a common reason. We hold the talk with the supplier on the disputed issue and secure a solution — rework, compensation or another result in your favor." },
          { q: "How is this different from inspection and production control?", a: "Inspection and control are about checking the goods and production. Negotiations are about the conversation with the supplier itself: terms, prices, disputes. They often go together." },
          { q: "What do you need from me to start?", a: "A description of the situation, your goals and limits, and the supplier's contacts. Based on them we agree the negotiation plan." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Leave the talk with your supplier to those who speak their language",
          subtitle: "Tell us the situation and goals — we'll agree a plan and negotiate with the supplier for you.",
          button: "Submit a request",
        },
      },
      upakovka: {
        metaTitle: "Packaging and labeling of goods in China for import into Russia | BARS TLC",
        metaDescription:
          "We'll pack and label the goods in China so they arrive intact and clear customs: transport packaging, EAC labeling, applying Chestny Znak codes. Guangzhou.",
        hero: {
          title: "Packaging and labeling of goods in China",
          subtitle:
            "We'll pack and label your goods while still in China — so they arrive intact and clear customs without issues.",
          photoCaption: "Photo: packaging and applying labels at the warehouse",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "This is preparing the goods for dispatch from China: transport packaging so the cargo arrives intact, and labeling so it clears customs without delays. We do it at our warehouse or the supplier's — wherever is more convenient for the batch's logistics.",
            "The word 'labeling' hides two different things, and it's important not to confuse them: accompanying labeling for customs and the EAEU (data on the goods, manufacturer, importer, the EAC mark) and Chestny Znak digital labeling (Data Matrix codes for tracking goods in Russia). We work with both, but on Chestny Znak there's a fundamental caveat — honestly, below.",
          ],
        },
        zachem: {
          title: "Why it's needed",
          intro: "An error in packaging or labeling surfaces at the worst moment — at customs or already at acceptance, when the money is spent and the goods are stuck:",
          pains: [
            { lead: "The cargo arrives damaged or damp.", text: "Weak transport packaging doesn't withstand transport and transloading." },
            { lead: "Customs won't release it over labeling.", text: "No EAC mark, no manufacturer/importer data, the labeling is unreadable or hidden under packaging." },
            { lead: "Chestny Znak codes are wrong or won't scan.", text: "Chinese codes applied instead of Russian ones, they don't scan, they're stuck on the wrong goods — and the batch is turned back." },
            { lead: "Labeling doesn't match the documents.", text: "The actual goods diverge from what's declared." },
          ],
          closing: "Packaging is the goods' armor, labeling is their passport at customs; an error in either costs more than doing it right the first time.",
        },
        kakDelaem: {
          title: "How we do it",
          photoCaption: "Photo: applying and checking codes with a scanner",
          steps: [
            { title: "We determine the requirements for your goods", text: "What type of transport packaging is needed, what labeling is mandatory under EAEU technical regulations, whether Chestny Znak is needed for your category — we advise whether your goods fall under mandatory labeling." },
            { title: "We pack for transport", text: "We choose packaging for the shipping method and the cargo's fragility: export boxes, crating or a wooden case for oversized items, securing in the container/truck." },
            { title: "We apply the accompanying labeling", text: "Manufacturer and importer data, product name and specs, the EAC mark, handling marks — readable and in a visible place, as customs requires." },
            { title: "We apply Chestny Znak codes (if needed)", text: "As the importer you generate the codes in the CRPT system and pass them to us — we apply them to the goods in China before shipment and verify with a scanner that the codes read and match the goods." },
            { title: "We reconcile labeling with documents", text: "Before dispatch we check that the actual labeling matches what will go into the declaration." },
          ],
        },
        chestnyyZnak: {
          title: "An important caveat on Chestny Znak",
          intro: "Chestny Znak codes can only be obtained in the Russian CRPT system — they're generated by the importer in Russia, not the Chinese factory. A supplier or intermediary in China can only apply the codes, not issue them. So 'turnkey Chestny Znak labeling in China' without your Russian legal entity involved is either a simplification or a reason to be wary.",
          closing: "We honestly separate the areas of responsibility: as the importer you obtain the codes in CRPT, and we correctly apply them in China and verify them before shipment, so there are no surprises at customs or acceptance.",
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "Goods in transport packaging designed for your shipping — without breakage or damp.",
            "Accompanying labeling to EAEU requirements, including the EAC mark.",
            "Correctly applied and verified Chestny Znak codes (if needed).",
            "Labeling that matches the documents — no delays at customs.",
            "Preparation at our warehouse or the supplier's — per your batch's logistics.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "Where do you pack and label — at yours or the supplier's?", a: "Both. We do it at our warehouse or the supplier's — chosen by how your batch's logistics is set up and where it's cheaper and faster." },
          { q: "Can you apply Chestny Znak right in China?", a: "Applying — yes. But you obtain the codes themselves in the Russian CRPT system as the importer and pass them to us: the Chinese side applies the codes but doesn't generate them. We don't handle CRPT registration — we apply your already-obtained codes in China before shipment and verify with a scanner." },
          { q: "Will you advise whether my goods need mandatory labeling?", a: "Yes, we advise: the EAC mark and accompanying labeling are needed for most goods, Chestny Znak — only for categories on the mandatory-labeling list. We determine it for your goods at the start." },
          { q: "What happens if the labeling is done wrong?", a: "Customs may not release the cargo, and the marketplace may not accept the batch. That's why we verify the codes' readability, their match to the goods and the documents before dispatch." },
          { q: "Can you prepare goods for a marketplace (Ozon, Wildberries)?", a: "We don't pack to marketplace requirements in China ourselves, but we have a fulfillment partner in Moscow — preparation for Ozon/Wildberries (stickers, barcodes, boxes) can be arranged through them in Russia." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Prepare the cargo so customs finds nothing to fault",
          subtitle: "Tell us about the goods and the shipping method — we'll pack for transport and apply all the needed labeling while still in China.",
          button: "Submit a request",
        },
      },
      sertifikaciya: {
        metaTitle: "Turnkey certification of goods from China with sample import | BARS TLC",
        metaDescription:
          "We fully support certification of goods from China: sample selection and official import by air, testing, documents, registration of DoC/CoC for your customs clearance. Guangzhou.",
        hero: {
          title: "Certification of goods from China",
          subtitle:
            "We take on the entire path of obtaining permits — from selecting samples in China to a registered declaration or certificate for your customs clearance.",
          photoCaption: "Photo: product samples / permits",
        },
        chtoEto: {
          title: "What this service is",
          paragraphs: [
            "Most goods from China can't be legally imported and sold in Russia without a permit — a declaration (DoC) or certificate (CoC) of conformity under EAEU technical regulations. Without it, customs won't release the cargo, and selling risks fines and confiscation.",
            "We support obtaining this documentation turnkey: we determine exactly what your goods need, select and import samples from China, run the testing, gather the documents and take it to a registered document through an accredited body. Since our team is in China, we take on the most labor-intensive part — the samples and their legal import — rather than shifting it onto you.",
          ],
        },
        otlichieList: {
          title: "Where we differ",
          intro: "Most companies, asked about certification, simply give you the contact of a certification center — and leave you alone with the work. From there the hardest part falls on you:",
          items: [
            { lead: "Determine the product type and scheme yourself.", text: "An error in the HS code or the declaration scheme — and the document is issued for the wrong thing." },
            { lead: "Arrange sample import yourself.", text: "For many goods, testing requires physical samples from China — and they still have to be imported legally." },
            { lead: "Gather and correctly fill out the documents yourself.", text: "Contract, invoice, technical documentation, authorized-representative agreement — an error stalls the whole process." },
            { lead: "Be left with the risk that the document doesn't fit.", text: "The certification center doesn't care whether its document fits your specific customs clearance. And the cost of such an error is sometimes hundreds of thousands of rubles." },
          ],
          closing: "We don't hand you off midway — we support the process from a sample in China to a registered document that will fit your clearance.",
        },
        kakDelaem: {
          title: "How we support certification",
          photoCaption: "Photo: lab testing / document processing",
          steps: [
            { title: "We determine what your goods need", text: "Which EAEU technical regulation the goods fall under, what's required — a declaration, certificate or state-registration certificate — and by which scheme. We immediately reconcile with the HS code for your customs clearance." },
            { title: "We select samples", text: "Our team in China selects the samples needed for testing from the supplier." },
            { title: "We import samples officially by air", text: "We legally deliver the samples for testing — part of the work usually shifted onto the client." },
            { title: "We run the testing", text: "We arrange tests in an accredited laboratory to the requirements of the relevant technical regulation — the basis for the test report." },
            { title: "We gather and process the documents", text: "We prepare and check the whole package: contract, invoice, technical documentation, manufacturer and importer data." },
            { title: "We register the document", text: "Through an accredited body we take it to a registered DoC or CoC — agreed so it fits your clearance rather than existing on its own." },
          ],
        },
        chtoPoluchaete: {
          title: "What you get",
          items: [
            "The document type and scheme determined for your goods — no guessing.",
            "Samples selected and legally imported from China — without your involvement in that part.",
            "Testing done in an accredited laboratory.",
            "A gathered and correctly processed document package.",
            "A registered DoC or CoC through an accredited body, aligned with your customs clearance.",
            "The risk of an error worth hundreds of thousands of rubles removed.",
          ],
        },
        faqTitle: "Frequently asked questions",
        faq: [
          { q: "How are you different from a certification center?", a: "A center issues a document based on what you bring it and isn't responsible for whether it fits your clearance. We support the whole process: determine the document type, select and import samples from China, run testing and register the document through an accredited body for your customs clearance." },
          { q: "Why are samples needed and who imports them?", a: "For many goods, testing is done on physical samples. We select them from the supplier in China and import them officially by air — we take on this labor-intensive part rather than shifting it onto you." },
          { q: "How do I know which document my goods need?", a: "It depends on the category and the EAEU technical regulation: some goods need a declaration, others a certificate or state-registration certificate. We determine it for your goods at the start and immediately reconcile with the HS code." },
          { q: "Do you take it to a finished document or only prepare the papers?", a: "Turnkey: we work through an accredited body and take it to a registered declaration or certificate, aligned with your customs clearance." },
          { q: "How long does certification take?", a: "From 1 week to 2 months — it depends on the goods, the technical regulation, the number of test reports and the scheme. We'll name the exact time for your goods at the start." },
        ],
        relatedTitle: "Often ordered together",
        fullCycle: {
          label: "Need the full cycle?",
          text: "Turnkey purchasing: from factory search to shipment and delivery to Russia.",
        },
        cta: {
          title: "Don't be left alone with certification",
          subtitle: "Tell us about the goods — we'll determine which document is needed, select and import samples and take the process to a registered document for your clearance.",
          button: "Submit a request",
        },
      },
    },
  },
};

export default en;
