---
name: Feature request
description: Proposer une amélioration FoodNote
title: "[Feature] "
labels: [enhancement]
body:
  - type: textarea
    id: need
    attributes:
      label: Besoin utilisateur
      description: Quel problème concret veux-tu résoudre ?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposition
      description: Comment imagines-tu la solution ?
    validations:
      required: true
