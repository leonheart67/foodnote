// Aliments de base disponibles dans la BDD réutilisable.
// Ils ne sont PAS ajoutés automatiquement à la journée et ne sont jamais précochés.
// Ils servent seulement de raccourcis dans "Réutiliser un aliment".
const STARTER_ALIMENTS_FIRST_LAUNCH = [
  {id:-101, nom:"Pain", kcal100:251, prot100:8.6, gluc100:51, lip100:2.9},
  {id:-102, nom:"Œuf entier", kcal100:143, prot100:12.6, gluc100:0.7, lip100:9.5},
  {id:-103, nom:"Pâtes cuites", kcal100:157, prot100:5.8, gluc100:31, lip100:0.9},
  {id:-104, nom:"Riz cuit", kcal100:130, prot100:2.7, gluc100:28, lip100:0.3},
  {id:-105, nom:"Pommes de terre cuites", kcal100:87, prot100:1.9, gluc100:20.1, lip100:0.1},
  {id:-106, nom:"Skyr nature", kcal100:57, prot100:10, gluc100:4, lip100:0.2},
  {id:-107, nom:"Fromage blanc", kcal100:55, prot100:8, gluc100:3.2, lip100:0.8},
  {id:-108, nom:"Thon au naturel", kcal100:103, prot100:23, gluc100:0, lip100:1},
  {id:-109, nom:"Jambon blanc", kcal100:115, prot100:20, gluc100:0.5, lip100:2.5},
  {id:-110, nom:"Blanc de poulet cuit", kcal100:165, prot100:31, gluc100:0, lip100:3.6},
  {id:-111, nom:"Banane", kcal100:89, prot100:1.1, gluc100:22.8, lip100:0.3},
  {id:-112, nom:"Pomme", kcal100:52, prot100:0.3, gluc100:14, lip100:0.2},
  {id:-113, nom:"Amandes", kcal100:580, prot100:20, gluc100:20, lip100:50},
  {id:-114, nom:"Huile d’olive", kcal100:884, prot100:0, gluc100:0, lip100:100},
];
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
