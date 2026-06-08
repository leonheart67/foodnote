/*
  Fichier : 06-foodnote-ui-taxonomy.js

  Rôle :
  - Ajouter une nomenclature UI commune aux éléments existants de FoodNote.
  - Normaliser les repères visuels sans modifier les hooks JavaScript existants.
  - Permettre au CSS général de cibler des familles stables :
    fn-page, fn-panel, fn-widget, fn-metric, fn-row, fn-field, fn-pill,
    fn-btn, fn-icon, fn-list, fn-grid.
  - Couvrir aussi les éléments créés dynamiquement après chargement, notamment Récap.

  Ce fichier gère :
  - L'ajout non destructif de classes CSS communes.
  - L'observation légère du DOM pour classer les nouveaux éléments.

  Ce fichier ne doit pas gérer :
  - La navigation showPage().
  - Le contenu métier.
  - SQLite, CIQUAL, OpenFoodFacts, Groq.
  - Les calculs nutritionnels.
  - Les styles eux-mêmes : ils sont organisés via assets/css/app.css et assets/css/modules/.
*/

(function initFoodNoteUiTaxonomy() {
  "use strict";

  const RULES = [
    {
      className: "fn-page",
      selectors: [
        ".page"
      ]
    },
    {
      className: "fn-panel",
      selectors: [
        ".journal-floating-macro-card",
        ".journal-main-card",
        ".journal-section-card",
        ".journal-foods-block",
        ".journal-meals-card",
        ".fn-ui-panel",
        ".fn-ui-panel-pad",
        ".profile-summary-main",
        "details.card",
        "#page-objectif > .card",
        "#page-recap .card",
        "#page-stats .card",
        "#page-bases .card",
        "#page-donnees .card",
        "#page-ia .card",
        ".database-explorer-card",
        ".notification-card",
        ".food-add-dialog"
      ]
    },
    {
      className: "fn-widget",
      selectors: [
        ".fn-ui-surface-soft",
        ".fn-ui-feature",
        ".fn-ui-tile",
        ".fn-ui-alert",
        ".journal-tile-card",
        ".food-current-meal-card",
        ".ocr-panel",
        ".recipe-ai-result",
        ".barcode-result",
        ".stats-commercial-grid > *",
        ".objectif-commercial-grid > *",
        ".objectif-target-grid > *",
        ".recap-card",
        ".recap-section",
        ".recap-panel",
        ".recap-grid > *",
        "[class*='phase-card']",
        "[class*='phase-item']",
        "[class*='target-tile']",
        "[class*='summary-card']"
      ]
    },
    {
      className: "fn-metric",
      selectors: [
        ".fn-calorie-summary-card",
        ".fn-home-macro-row",
        ".macro-cell-prot",
        ".macro-cell-gluc",
        ".macro-cell-lip",
        ".stats-commercial-grid > *",
        ".objectif-commercial-grid > *",
        ".objectif-target-grid > *",
        ".stat-card",
        ".fn-ui-chart-tile",
        "[class*='metric']",
        "[class*='kcal']",
        "[class*='calorie']",
        "[class*='protein']",
        "[class*='prot']",
        "[class*='gluc']",
        "[class*='carb']",
        "[class*='lip']",
        "[class*='fat']"
      ]
    },
    {
      className: "fn-row",
      selectors: [
        ".journal-food-row",
        ".entry-row",
        ".food-line",
        ".db-row",
        ".database-row",
        ".custom-food-row",
        ".aliment-item",
        ".recap-row",
        ".recap-item",
        ".meal-row",
        ".sport-row",
        "tbody tr"
      ]
    },
    {
      className: "fn-field",
      selectors: [
        "input",
        "select",
        "textarea",
        ".db-search-input",
        ".db-qty-input",
        ".fn-ui-field input",
        ".fn-ui-field select",
        ".fn-ui-field textarea"
      ]
    },
    {
      className: "fn-pill",
      selectors: [
        ".badge",
        "[class*='badge']",
        "[class*='chip']",
        "[class*='pill']",
        ".food-source-chip",
        ".food-meal-chip",
        ".fn-orbit-status",
        ".profile-chip"
      ]
    },
    {
      className: "fn-btn",
      selectors: [
        "button",
        ".btn-primary",
        ".fn-ui-button",
        ".journal-add-btn",
        ".journal-date-launch",
        ".journal-day-nav"
      ]
    },
    {
      className: "fn-icon",
      selectors: [
        ".fn-ui-icon",
        ".fn-section-icon",
        ".journal-meals-icon",
        ".fn-mini-ring",
        ".fn-macro-icon-bubble",
        ".fn-nutri-home-icon",
        "[class*='icon']",
        "[class*='emoji']"
      ]
    },
    {
      className: "fn-list",
      selectors: [
        ".meal-list",
        "#hist-list",
        ".data-list",
        ".recap-list",
        ".database-list"
      ]
    },
    {
      className: "fn-grid",
      selectors: [
        ".stats-commercial-grid",
        ".objectif-commercial-grid",
        ".objectif-target-grid",
        ".fn-ui-feature-grid",
        ".journal-extra-grid",
        ".recap-grid",
        ".database-grid",
        ".chart-grid",
        ".stats-grid"
      ]
    }
  ];

  const ACCENT_RULES = [
    {
      className: "fn-accent-kcal",
      selectors: [
        "[data-macro='kcal']",
        ".macro-cell-kcal",
        ".fn-calorie-summary-card",
        "[class*='kcal']",
        "[class*='calorie']"
      ]
    },
    {
      className: "fn-accent-protein",
      selectors: [
        "[data-macro='prot']",
        ".macro-cell-prot",
        "[class*='protein']",
        "[class*='prot']"
      ]
    },
    {
      className: "fn-accent-carbs",
      selectors: [
        "[data-macro='gluc']",
        ".macro-cell-gluc",
        "[class*='gluc']",
        "[class*='carb']"
      ]
    },
    {
      className: "fn-accent-fat",
      selectors: [
        "[data-macro='lip']",
        ".macro-cell-lip",
        "[class*='lip']",
        "[class*='fat']"
      ]
    },
    {
      className: "fn-accent-good",
      selectors: [
        "[class*='success']",
        "[class*='good']",
        "[class*='ok']"
      ]
    },
    {
      className: "fn-accent-warning",
      selectors: [
        "[class*='warning']",
        "[class*='warn']",
        "[class*='alert']"
      ]
    },
    {
      className: "fn-accent-danger",
      selectors: [
        "[class*='danger']",
        "[class*='error']",
        "[class*='bad']"
      ]
    }
  ];

  function applyRule(root, rule) {
    for (const selector of rule.selectors) {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch (error) {
        continue;
      }

      nodes.forEach((node) => {
        if (node && node.classList) {
          node.classList.add(rule.className);
        }
      });
    }
  }

  function classify(root = document) {
    [...RULES, ...ACCENT_RULES].forEach((rule) => applyRule(root, rule));
  }

  function scheduleClassify() {
    if (scheduleClassify.pending) return;
    scheduleClassify.pending = true;

    window.requestAnimationFrame(() => {
      scheduleClassify.pending = false;
      classify(document);
    });
  }

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldClassify = false;

      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          shouldClassify = true;
          break;
        }

        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          shouldClassify = true;
          break;
        }
      }

      if (shouldClassify) scheduleClassify();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      classify(document);
      startObserver();
    }, { once: true });
  } else {
    classify(document);
    startObserver();
  }

  window.FoodNoteUiTaxonomy = {
    classify
  };
})();
