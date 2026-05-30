// FoodNote beta 0.22.54 — Récap intelligent : pont compat, rendu réservé à la page Récap
(function(){
  'use strict';

  function render(){
    const grid = document.getElementById('recap-metrics');
    if (!grid) return;
    if (typeof window.renderFoodnoteSmartDashboardMetrics === 'function') {
      window.renderFoodnoteSmartDashboardMetrics(grid, {mode:'recap', editorTargetId:'recap-dashboard-editor'});
    }
  }

  window.renderRecapDashboardBadges = render;
  window.toggleRecapBadgeEdit = function(force){
    if (typeof window.toggleFoodnoteDashboardEdit === 'function') window.toggleFoodnoteDashboardEdit(force);
    else render();
  };
  window.setRecapBadgeVisible = function(key, visible){
    if (typeof window.setFoodnoteDashboardBadgeVisible === 'function') window.setFoodnoteDashboardBadgeVisible(key, visible);
    else render();
  };
  window.moveRecapBadge = function(key, delta){
    if (typeof window.moveFoodnoteDashboardBadge === 'function') window.moveFoodnoteDashboardBadge(key, delta);
    else render();
  };
  window.resetRecapBadges = function(){
    if (typeof window.resetFoodnoteDashboardBadges === 'function') window.resetFoodnoteDashboardBadges();
    else render();
  };

  function hookRenderRecap(){
    if (typeof window.renderRecap === 'function' && !window.renderRecap.__foodnoteRecapDesignEditorHooked) {
      const original = window.renderRecap;
      window.renderRecap = function(){
        const result = original.apply(this, arguments);
        setTimeout(render, 0);
        return result;
      };
      window.renderRecap.__foodnoteRecapDesignEditorHooked = true;
    }
  }
  function hookShowPage(){
    if (typeof window.showPage === 'function' && !window.showPage.__foodnoteRecapDesignEditorHooked) {
      const original = window.showPage;
      window.showPage = function(page){
        const result = original.apply(this, arguments);
        if (String(page) === 'recap') setTimeout(render, 50);
        return result;
      };
      window.showPage.__foodnoteRecapDesignEditorHooked = true;
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    hookRenderRecap();
    hookShowPage();
    if (document.getElementById('page-recap')?.classList.contains('active')) setTimeout(render, 150);
  });
  hookRenderRecap();
  hookShowPage();
})();
