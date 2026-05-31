/*
 * FoodNote — données statiques générales.
 * Rôle : déclarer les constantes de référence partagées par l'interface.
 * Gère : sports de base, catégories et phases nutritionnelles prédéfinies.
 * Ne doit pas gérer : liste détaillée des aliments de démarrage, sauvegarde SQLite,
 *                  import CIQUAL/OpenFoodFacts, ni logique d'interface.
 */

// Les aliments de démarrage sont isolés dans 11-starter-foods.js.
// ALIMENTS_BASE reste volontairement vide : la base réutilisable vient de SQLite.
const ALIMENTS_BASE = [];

const SPORTS_BASE = [
  // Cyclisme
  {nom:"VTT (modéré)", kcalH:430, cat:"Cyclisme"},
  {nom:"VTT (intense)", kcalH:600, cat:"Cyclisme"},
  {nom:"Vélo route (modéré)", kcalH:480, cat:"Cyclisme"},
  {nom:"Vélo route (intense)", kcalH:650, cat:"Cyclisme"},
  {nom:"Vélo elliptique", kcalH:400, cat:"Cyclisme"},
  // Course / Marche
  {nom:"Course à pied (10 km/h)", kcalH:600, cat:"Course"},
  {nom:"Course à pied (12 km/h)", kcalH:750, cat:"Course"},
  {nom:"Course à pied (15 km/h)", kcalH:900, cat:"Course"},
  {nom:"Trail / running montagne", kcalH:700, cat:"Course"},
  {nom:"Marche rapide", kcalH:280, cat:"Course"},
  {nom:"Randonnée", kcalH:350, cat:"Course"},
  // Musculation / Force
  {nom:"Musculation (modéré)", kcalH:250, cat:"Musculation"},
  {nom:"Musculation (intense)", kcalH:400, cat:"Musculation"},
  {nom:"CrossFit", kcalH:600, cat:"Musculation"},
  {nom:"Calisthenics", kcalH:350, cat:"Musculation"},
  {nom:"Kettlebell", kcalH:500, cat:"Musculation"},
  // Natation
  {nom:"Natation (modéré)", kcalH:450, cat:"Natation"},
  {nom:"Natation (intense)", kcalH:600, cat:"Natation"},
  {nom:"Aquagym", kcalH:300, cat:"Natation"},
  // Sports collectifs
  {nom:"Football", kcalH:550, cat:"Sports collectifs"},
  {nom:"Basketball", kcalH:500, cat:"Sports collectifs"},
  {nom:"Tennis", kcalH:480, cat:"Sports collectifs"},
  {nom:"Badminton", kcalH:400, cat:"Sports collectifs"},
  {nom:"Volleyball", kcalH:350, cat:"Sports collectifs"},
  {nom:"Rugby", kcalH:600, cat:"Sports collectifs"},
  // Arts martiaux
  {nom:"Boxe / MMA", kcalH:650, cat:"Arts martiaux"},
  {nom:"Judo / Karaté", kcalH:450, cat:"Arts martiaux"},
  // Bien-être
  {nom:"Yoga", kcalH:150, cat:"Bien-être"},
  {nom:"Pilates", kcalH:200, cat:"Bien-être"},
  {nom:"Stretching", kcalH:100, cat:"Bien-être"},
  // Hiver
  {nom:"Ski alpin", kcalH:400, cat:"Hiver"},
  {nom:"Ski de fond", kcalH:600, cat:"Hiver"},
  // Divers
  {nom:"Escalade", kcalH:450, cat:"Divers"},
  {nom:"Danse", kcalH:350, cat:"Divers"},
  {nom:"Corde à sauter", kcalH:700, cat:"Divers"},
  {nom:"Roller / Skate", kcalH:380, cat:"Divers"},
  {nom:"Travaux / Jardinage", kcalH:200, cat:"Divers"},
];

const CATS = {fixe:"list-custom",prot:"list-custom",fec:"list-custom",fruits:"list-custom",snacks:"list-custom",custom:"list-custom"};
// Phases prédéfinies — l'utilisateur choisit son objectif
const PHASES_PREDEF = {
  perte: {
    label: 'Perte de poids',
    icon: '📉',
    description: 'Déficit calorique modéré pour perdre du gras en préservant le muscle.',
    kcalFn: (tdee) => Math.round(tdee * 0.80),
    protFn: (poids) => Math.round(poids * 2.0),
    glucFn: (kcal, prot, lip) => Math.round((kcal - prot*4 - lip*9) / 4),
    lipFn: (poids) => Math.round(poids * 0.8),
    conseil: 'Déficit de ~20% des besoins. Protéines élevées pour préserver le muscle.',
  },
  recomp: {
    label: 'Recomposition',
    icon: '⚖️',
    description: 'Maintenance ou léger surplus pour construire du muscle et perdre du gras simultanément.',
    kcalFn: (tdee) => Math.round(tdee * 1.00),
    protFn: (poids) => Math.round(poids * 2.0),
    glucFn: (kcal, prot, lip) => Math.round((kcal - prot*4 - lip*9) / 4),
    lipFn: (poids) => Math.round(poids * 1.0),
    conseil: 'Calories = maintenance. Patience : les résultats sont lents mais durables.',
  },
  sechage: {
    label: 'Séchage',
    icon: '🔥',
    description: 'Déficit important pour révéler la musculature existante.',
    kcalFn: (tdee) => Math.round(tdee * 0.75),
    protFn: (poids) => Math.round(poids * 2.4),
    glucFn: (kcal, prot, lip) => Math.round((kcal - prot*4 - lip*9) / 4),
    lipFn: (poids) => Math.round(poids * 0.7),
    conseil: 'Déficit de ~25%. Protéines très élevées. Durée limitée à 8-12 semaines.',
  },
  prise: {
    label: 'Prise de masse',
    icon: '💪',
    description: 'Surplus calorique pour maximiser la prise de muscle.',
    kcalFn: (tdee) => Math.round(tdee * 1.15),
    protFn: (poids) => Math.round(poids * 1.8),
    glucFn: (kcal, prot, lip) => Math.round((kcal - prot*4 - lip*9) / 4),
    lipFn: (poids) => Math.round(poids * 1.0),
    conseil: 'Surplus de ~15%. Accepte une légère prise de gras. Durée 3-6 mois.',
  },
  maintenance: {
    label: 'Maintenance',
    icon: '🎯',
    description: 'Maintenir le poids et la composition corporelle actuels.',
    kcalFn: (tdee) => Math.round(tdee * 1.00),
    protFn: (poids) => Math.round(poids * 1.6),
    glucFn: (kcal, prot, lip) => Math.round((kcal - prot*4 - lip*9) / 4),
    lipFn: (poids) => Math.round(poids * 1.0),
    conseil: 'Calories = dépense totale estimée. Bonne base pour une alimentation durable.',
  },
};
