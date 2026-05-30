---
name: Bug report
description: Signaler un bug FoodNote
title: "[Bug] "
labels: [bug]
body:
  - type: textarea
    id: description
    attributes:
      label: Description
      description: Que se passe-t-il ?
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Étapes pour reproduire
      placeholder: |
        1. Aller dans ...
        2. Cliquer sur ...
        3. Constater ...
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Comportement attendu
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Version FoodNote
      placeholder: "0.22.179"
  - type: textarea
    id: logs
    attributes:
      label: Logs / console navigateur
      render: text
