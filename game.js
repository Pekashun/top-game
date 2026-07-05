(function () {
  "use strict";

  const Rules = window.Rules;

  let state = Rules.createInitialState();
  state.message = "ゲーム開始！あなたの番です。🐰をタップして移動、または強化を購入してください。";

  const cellEls = [];
  const upgradeButtonEls = {};

  // ---- DOM setup ----
  const boardEl = document.getElementById("board");
  const turnNumberEl = document.getElementById("turnNumber");
  const playerResourcesEl = document.getElementById("playerResources");
  const cpuResourcesEl = document.getElementById("cpuResources");
  const playerBadgesEl = document.getElementById("playerUpgradeBadges");
  const cpuBadgesEl = document.getElementById("cpuUpgradeBadges");
  const messageBarEl = document.getElementById("messageBar");
  const upgradePanelEl = document.getElementById("upgradePanel");
  const resultScreenEl = document.getElementById("resultScreen");
  const resultTitleEl = document.getElementById("resultTitle");
  const resultDetailEl = document.getElementById("resultDetail");
  const playAgainBtn = document.getElementById("playAgainBtn");

  function buildBoardDOM() {
    boardEl.innerHTML = "";
    for (let r = 0; r < Rules.BOARD_SIZE; r++) {
      const rowEls = [];
      for (let c = 0; c < Rules.BOARD_SIZE; c++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tile";
        btn.dataset.row = String(r);
        btn.dataset.col = String(c);
        boardEl.appendChild(btn);
        rowEls.push(btn);
      }
      cellEls.push(rowEls);
    }
  }

  function buildUpgradePanelDOM() {
    upgradePanelEl.innerHTML = "";
    const entries = Object.values(Rules.UPGRADE_CATALOG).filter((def) => def.sides.includes("player"));
    entries.forEach((def) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "upgrade-btn";
      btn.dataset.upgrade = def.id;
      btn.innerHTML =
        `<span class="upgrade-title">${def.name}</span>` +
        `<span class="upgrade-desc">${def.desc}</span>` +
        `<span class="upgrade-cost">コスト: <span class="cost-value"></span></span>`;
      btn.addEventListener("click", () => handleUpgradeClick(def.id));
      upgradePanelEl.appendChild(btn);
      upgradeButtonEls[def.id] = btn;
    });
  }

  // ---- Message helpers ----
  function buildMoveMessage(mover, result) {
    const parts = [];
    if (result.harvested) {
      parts.push(
        `${mover.label}が${result.resourceType === "rich" ? "リッチな" : ""}資源を収穫！（+${result.harvestValue}）`
      );
    } else {
      parts.push(`${mover.label}が移動しました。`);
    }
    if (result.recaptureBonus > 0) {
      parts.push(`奪い返しボーナス+${result.recaptureBonus}`);
    }
    if (result.neighborsClaimed.length > 0) {
      parts.push(`周囲${result.neighborsClaimed.length}マスも陣地化！`);
    }
    return parts.join(" ");
  }

  // ---- Turn flow ----
  function beginPlayerTurn() {
    Rules.applyPassiveIncome("player", state);
    state.phase = "player_turn";
    state.selectedTile = null;
    state.currentMovesLeft = Rules.movesPerTurn("player", state);
    state.moveMadeThisTurn = false;

    const legal = Rules.getLegalMoves("player", state);
    const affordable = Rules.getAffordableUpgrades("player", state);
    if (legal.length === 0 && affordable.length === 0) {
      state.message = "うさぎは動けず、買える強化もありません（パス）。";
      endPlayerTurnAndStartCpu();
      return;
    }

    state.message = "あなたの番です。🐰をタップして移動、または強化を購入してください。";
    render();
  }

  function handleTileClick(row, col) {
    if (state.phase !== "player_turn") return;
    const player = state.players.player;

    if (!state.selectedTile) {
      if (row === player.row && col === player.col) {
        state.selectedTile = { row, col };
        render();
      }
      return;
    }

    const legal = Rules.getLegalMoves("player", state);
    const isLegal = legal.some((m) => m.row === row && m.col === col);
    if (!isLegal) {
      state.selectedTile = null;
      render();
      return;
    }

    const result = Rules.performMoveCycle("player", { row, col }, state);
    state.moveMadeThisTurn = true;
    state.currentMovesLeft--;
    state.selectedTile = null;
    state.message = buildMoveMessage(player, result);

    if (state.currentMovesLeft > 0 && Rules.getLegalMoves("player", state).length === 0) {
      state.currentMovesLeft = 0;
    }

    if (state.currentMovesLeft <= 0) {
      endPlayerTurnAndStartCpu();
    } else {
      render();
    }
  }

  function handleUpgradeClick(key) {
    if (state.phase !== "player_turn") return;
    if (state.moveMadeThisTurn) return;
    const player = state.players.player;
    if (player.upgrades[key]) return;

    const cost = Rules.computeUpgradeCost("player", key, state);
    if (player.resources < cost) return;

    Rules.learnUpgrade("player", key, state);
    state.message = `「${Rules.UPGRADE_CATALOG[key].name}」を習得した！（-${cost}）`;
    endPlayerTurnAndStartCpu();
  }

  function endPlayerTurnAndStartCpu() {
    state.phase = "cpu_turn";
    render();
    setTimeout(beginCpuTurn, 500);
  }

  function beginCpuTurn() {
    Rules.applyPassiveIncome("cpu", state);
    const decision = Rules.decideTurnAction("cpu", state, Math.random);

    if (decision.type === "buy") {
      const cost = Rules.learnUpgrade("cpu", decision.upgradeKey, state);
      state.message = `シマエナガが「${Rules.UPGRADE_CATALOG[decision.upgradeKey].name}」を習得した！（-${cost}）`;
      render();
      setTimeout(finishCpuTurn, 500);
    } else if (decision.type === "move") {
      state.cpuMovesLeft = Rules.movesPerTurn("cpu", state);
      runCpuMoveSegment();
    } else {
      state.message = "シマエナガは動けず、買える強化もありません（パス）。";
      render();
      setTimeout(finishCpuTurn, 500);
    }
  }

  function runCpuMoveSegment() {
    if (state.cpuMovesLeft <= 0) {
      finishCpuTurn();
      return;
    }
    const legal = Rules.getLegalMoves("cpu", state);
    if (legal.length === 0) {
      state.cpuMovesLeft = 0;
      render();
      setTimeout(finishCpuTurn, 400);
      return;
    }
    const dest = Rules.chooseAiMove(legal, "cpu", state, Math.random);
    const result = Rules.performMoveCycle("cpu", dest, state);
    state.cpuMovesLeft--;
    state.message = buildMoveMessage(state.players.cpu, result);
    render();
    setTimeout(runCpuMoveSegment, 550);
  }

  function finishCpuTurn() {
    render();
    setTimeout(advanceTurnCounterAndContinue, 500);
  }

  function advanceTurnCounterAndContinue() {
    state.turn++;
    Rules.advanceRegrowthQueue(state);
    if (state.turn > Rules.MAX_TURNS) {
      endGame();
    } else {
      beginPlayerTurn();
    }
  }

  function endGame() {
    state.phase = "game_over";
    state.gameOver = true;

    const counts = Rules.countTiles(state);
    const winner = Rules.getWinner(state);
    let winnerText;
    if (winner === "player") winnerText = "🐰 あなたの勝ち！";
    else if (winner === "cpu") winnerText = "🐦 CPUの勝ち！";
    else winnerText = "引き分け！";

    state.winner = winnerText;
    resultTitleEl.textContent = "結果発表";
    resultDetailEl.innerHTML = `${winnerText}<br>あなたの陣地: ${counts.player}マス / CPUの陣地: ${counts.cpu}マス`;
    resultScreenEl.classList.remove("hidden");
    render();
  }

  // ---- Event wiring ----
  boardEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tile");
    if (!btn) return;
    handleTileClick(Number(btn.dataset.row), Number(btn.dataset.col));
  });

  playAgainBtn.addEventListener("click", () => {
    state = Rules.createInitialState();
    state.message = "ゲーム開始！あなたの番です。🐰をタップして移動、または強化を購入してください。";
    resultScreenEl.classList.add("hidden");
    beginPlayerTurn();
  });

  // ---- Rendering ----
  function renderBoard() {
    const player = state.players.player;
    const cpu = state.players.cpu;
    const legalHighlight =
      state.phase === "player_turn" && state.selectedTile ? Rules.getLegalMoves("player", state) : [];

    for (let r = 0; r < Rules.BOARD_SIZE; r++) {
      for (let c = 0; c < Rules.BOARD_SIZE; c++) {
        const cell = cellEls[r][c];
        const tile = state.tiles[r][c];
        const classes = ["tile"];

        if (tile.owner === "player") classes.push("owner-player");
        else if (tile.owner === "cpu") classes.push("owner-cpu");
        else classes.push("owner-none");

        if (!tile.resource.harvested && tile.resource.type === "normal") classes.push("resource-normal");
        if (!tile.resource.harvested && tile.resource.type === "rich") classes.push("resource-rich");

        if (tile.shieldedAgainst && state.turn <= tile.shieldExpiresAfterTurn) {
          classes.push("shielded");
        }

        if (state.selectedTile && state.selectedTile.row === r && state.selectedTile.col === c) {
          classes.push("selected-char");
        }
        if (legalHighlight.some((m) => m.row === r && m.col === c)) {
          classes.push("selectable");
        }

        cell.className = classes.join(" ");

        let icon = "";
        if (player.row === r && player.col === c) icon = player.emoji;
        else if (cpu.row === r && cpu.col === c) icon = cpu.emoji;
        cell.innerHTML = icon ? `<span class="char-icon">${icon}</span>` : "";
      }
    }
  }

  function renderBadges(container, upgrades) {
    container.innerHTML = "";
    for (const key of Object.keys(upgrades)) {
      if (upgrades[key]) {
        const span = document.createElement("span");
        span.className = "badge";
        span.textContent = Rules.UPGRADE_CATALOG[key].name;
        container.appendChild(span);
      }
    }
  }

  function renderStatus() {
    turnNumberEl.textContent = String(Math.min(state.turn, Rules.MAX_TURNS));
    playerResourcesEl.textContent = String(state.players.player.resources);
    cpuResourcesEl.textContent = String(state.players.cpu.resources);
    renderBadges(playerBadgesEl, state.players.player.upgrades);
    renderBadges(cpuBadgesEl, state.players.cpu.upgrades);
  }

  function renderUpgradePanel() {
    const player = state.players.player;
    for (const key of Object.keys(upgradeButtonEls)) {
      const btn = upgradeButtonEls[key];
      const cost = Rules.computeUpgradeCost("player", key, state);
      btn.querySelector(".cost-value").textContent = String(cost);

      const learned = !!player.upgrades[key];
      btn.classList.toggle("learned", learned);

      const canBuy =
        state.phase === "player_turn" && !state.moveMadeThisTurn && !learned && player.resources >= cost;
      btn.disabled = !canBuy;
    }
  }

  function renderMessage() {
    messageBarEl.textContent = state.message || "";
  }

  function render() {
    renderBoard();
    renderStatus();
    renderUpgradePanel();
    renderMessage();
  }

  buildBoardDOM();
  buildUpgradePanelDOM();
  beginPlayerTurn();
})();
