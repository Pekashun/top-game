(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.Rules = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BOARD_SIZE = 9;
  const MAX_TURNS = 15;
  const NORMAL_HARVEST_VALUE = 1;
  const RICH_HARVEST_VALUE = 3;
  const REGROWTH_DELAY_TURNS = 3;
  const NEST_INCOME_DIVISOR = 3;
  const LATE_TURN_CUTOFF = 11;
  const BUY_EAGERNESS = 0.5;
  const MOVE_COST = 1;
  const STARTING_RESOURCES = 3;

  // Hand-authored resource layout, symmetric top/bottom and left/right.
  // '.' = none, 'n' = normal resource, 'r' = rich resource (center hotspot).
  const RESOURCE_LAYOUT_RAW = [
    ".n.....n.",
    "n..n.n..n",
    "..n...n..",
    ".n.rrr.n.",
    "...rrr...",
    ".n.rrr.n.",
    "..n...n..",
    "n..n.n..n",
    ".n.....n.",
  ];

  const RESOURCE_CHAR_MAP = { ".": "none", n: "normal", r: "rich" };

  const UPGRADE_CATALOG = {
    bountifulHarvest: {
      id: "bountifulHarvest",
      name: "ざくざく収穫",
      desc: "収穫量が2倍になる",
      sides: ["player", "cpu"],
      baseCost: 8,
      effects: { harvestMultiplier: 2 },
    },
    frugalSavings: {
      id: "frugalSavings",
      name: "がっちり貯金",
      desc: "今後の強化コストが1安くなる",
      sides: ["player", "cpu"],
      baseCost: 8,
      effects: { flatCostDiscount: 1 },
    },
    emptyRegrowth: {
      id: "emptyRegrowth",
      name: "からっぽ再生",
      desc: `収穫したマスが${REGROWTH_DELAY_TURNS}ターン後に再び収穫できる`,
      sides: ["player", "cpu"],
      baseCost: 8,
      effects: { regrowthOnOwnHarvest: REGROWTH_DELAY_TURNS },
    },
    hoppingDash: {
      id: "hoppingDash",
      name: "ぴょんぴょんダッシュ",
      desc: "1ターンに2回行動できる",
      sides: ["player"],
      baseCost: 21,
      effects: { extraMovesPerTurn: 1 },
    },
    longJump: {
      id: "longJump",
      name: "一足飛び",
      desc: "直進3マスジャンプが使えるようになる",
      sides: ["player"],
      baseCost: 20,
      effects: {
        extraMoveOffsets: [
          { dr: 3, dc: 0 },
          { dr: -3, dc: 0 },
          { dr: 0, dc: 3 },
          { dr: 0, dc: -3 },
        ],
      },
    },
    tailLure: {
      id: "tailLure",
      name: "しっぽふりふり陽動",
      desc: "着地マスの上下左右も同時に陣地化する（敵の陣地は奪えない）",
      sides: ["player"],
      baseCost: 22,
      effects: { claimOrthogonalNeighborsOnLanding: true },
    },
    earDash: {
      id: "earDash",
      name: "みみダッシュ",
      desc: "資源収穫時に+1される",
      sides: ["player"],
      baseCost: 9,
      effects: { flatHarvestBonus: 1 },
    },
    phantomLeap: {
      id: "phantomLeap",
      name: "まぼろし跳躍",
      desc: "相手の「わたげの盾」を無視して移動できる",
      sides: ["player"],
      baseCost: 11,
      effects: { ignoresShield: true },
    },
    nestBuilder: {
      id: "nestBuilder",
      name: "巣づくり上手",
      desc: "所有マス数に応じて毎ターン資源が自動で入る",
      sides: ["cpu"],
      baseCost: 6,
      effects: { passiveIncomePerTurn: { tilesPerResource: NEST_INCOME_DIVISOR } },
    },
    downyShield: {
      id: "downyShield",
      name: "わたげの盾",
      desc: "新しく陣地化したマスが敵の次の2ターンだけ守られる",
      sides: ["cpu"],
      baseCost: 5,
      effects: { shieldOnClaim: { turns: 2, against: "player" } },
    },
    wary: {
      id: "wary",
      name: "ちょこちょこ警戒",
      desc: "敵の陣地を奪うと+3される",
      sides: ["cpu"],
      baseCost: 5,
      effects: { flatRecaptureBonus: 3 },
    },
    winterWisdom: {
      id: "winterWisdom",
      name: "越冬の知恵",
      desc: "ターンが進むほど強化コストが安くなる",
      sides: ["cpu"],
      baseCost: 6,
      effects: { turnScaledCostDiscount: { divisor: 5 } },
    },
  };

  const PLAYER_UPGRADE_PRIORITY = [
    "hoppingDash",
    "longJump",
    "bountifulHarvest",
    "tailLure",
    "earDash",
    "frugalSavings",
    "emptyRegrowth",
    "phantomLeap",
  ];

  const CPU_UPGRADE_PRIORITY = [
    "downyShield",
    "nestBuilder",
    "bountifulHarvest",
    "wary",
    "frugalSavings",
    "winterWisdom",
    "emptyRegrowth",
  ];

  function knightOffsets() {
    // Front/back knight jumps (±2 rows, ±1 col) plus a 1-square sidestep left/right.
    return [
      { dr: 2, dc: 1 },
      { dr: 2, dc: -1 },
      { dr: -2, dc: 1 },
      { dr: -2, dc: -1 },
      { dr: 0, dc: 1 },
      { dr: 0, dc: -1 },
    ];
  }

  function silverOffsets(forwardDir) {
    return [
      { dr: 1 * forwardDir, dc: 0 },
      { dr: 1 * forwardDir, dc: -1 },
      { dr: 1 * forwardDir, dc: 1 },
      { dr: -1 * forwardDir, dc: -1 },
      { dr: -1 * forwardDir, dc: 1 },
    ];
  }

  const ORTHOGONAL_OFFSETS = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ];

  function oppositeSide(side) {
    return side === "player" ? "cpu" : "player";
  }

  function learnedKeys(player) {
    return Object.keys(player.upgrades).filter((k) => player.upgrades[k]);
  }

  function hasEffect(player, effectKey) {
    return learnedKeys(player).some((k) => UPGRADE_CATALOG[k].effects[effectKey] !== undefined);
  }

  function aggregateNumericEffect(player, effectKey, initial, combine) {
    let acc = initial;
    for (const key of learnedKeys(player)) {
      const value = UPGRADE_CATALOG[key].effects[effectKey];
      if (value !== undefined) acc = combine(acc, value);
    }
    return acc;
  }

  function createInitialState() {
    const tiles = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        const type = RESOURCE_CHAR_MAP[RESOURCE_LAYOUT_RAW[r][c]];
        row.push({
          owner: null,
          resource: { type, harvested: false },
          shieldedAgainst: null,
          shieldExpiresAfterTurn: null,
        });
      }
      tiles.push(row);
    }

    return {
      tiles,
      regrowthQueue: [],
      turn: 1,
      phase: "player_turn",
      selectedTile: null,
      currentMovesLeft: 1,
      moveMadeThisTurn: false,
      gameOver: false,
      winner: null,
      players: {
        player: {
          side: "player",
          row: 8,
          col: 4,
          forwardDir: -1,
          movePattern: "knight",
          resources: STARTING_RESOURCES,
          upgrades: {},
          label: "うさぎ",
          emoji: "🐰",
        },
        cpu: {
          side: "cpu",
          row: 0,
          col: 4,
          forwardDir: 1,
          movePattern: "silver",
          resources: STARTING_RESOURCES,
          upgrades: {},
          label: "シマエナガ",
          emoji: "🐦",
        },
      },
    };
  }

  function getLegalMoves(side, state) {
    const mover = state.players[side];
    if (mover.resources < MOVE_COST) return [];
    const offsets =
      mover.movePattern === "knight" ? knightOffsets() : silverOffsets(mover.forwardDir);
    const extraOffsets = [];
    for (const key of learnedKeys(mover)) {
      const effect = UPGRADE_CATALOG[key].effects.extraMoveOffsets;
      if (effect) extraOffsets.push(...effect);
    }
    const ignoresShield = hasEffect(mover, "ignoresShield");

    const seen = new Set();
    const moves = [];
    for (const { dr, dc } of offsets.concat(extraOffsets)) {
      const r = mover.row + dr;
      const c = mover.col + dc;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
      const key = r + "," + c;
      if (seen.has(key)) continue;
      seen.add(key);

      const tile = state.tiles[r][c];
      if (
        !ignoresShield &&
        tile.shieldedAgainst === side &&
        state.turn <= tile.shieldExpiresAfterTurn
      ) {
        continue;
      }
      moves.push({ row: r, col: c });
    }
    return moves;
  }

  function claimTile(state, side, row, col, isLanding) {
    const tile = state.tiles[row][col];
    tile.owner = side;
    tile.shieldedAgainst = null;
    tile.shieldExpiresAfterTurn = null;

    if (isLanding) {
      const mover = state.players[side];
      for (const key of learnedKeys(mover)) {
        const shieldEffect = UPGRADE_CATALOG[key].effects.shieldOnClaim;
        if (shieldEffect) {
          tile.shieldedAgainst = shieldEffect.against;
          tile.shieldExpiresAfterTurn = state.turn + shieldEffect.turns;
        }
      }
    }
  }

  function performMoveCycle(side, dest, state) {
    const mover = state.players[side];
    const opponentSide = oppositeSide(side);
    mover.row = dest.row;
    mover.col = dest.col;
    mover.resources -= MOVE_COST;

    const tile = state.tiles[dest.row][dest.col];
    const wasOpponentOwned = tile.owner === opponentSide;
    const resourceType = tile.resource.type;

    claimTile(state, side, dest.row, dest.col, true);

    const result = {
      row: dest.row,
      col: dest.col,
      resourceType,
      moveCost: MOVE_COST,
      harvested: false,
      harvestValue: 0,
      recaptureBonus: 0,
      neighborsClaimed: [],
    };

    if (resourceType !== "none" && !tile.resource.harvested) {
      let value = resourceType === "rich" ? RICH_HARVEST_VALUE : NORMAL_HARVEST_VALUE;
      value = aggregateNumericEffect(mover, "harvestMultiplier", value, (acc, m) => acc * m);
      value = aggregateNumericEffect(mover, "flatHarvestBonus", value, (acc, b) => acc + b);
      mover.resources += value;
      tile.resource.harvested = true;
      result.harvested = true;
      result.harvestValue = value;

      const regrowDelay = aggregateNumericEffect(mover, "regrowthOnOwnHarvest", 0, (acc, d) => acc + d);
      if (regrowDelay > 0) {
        state.regrowthQueue.push({ row: dest.row, col: dest.col, dueTurn: state.turn + regrowDelay });
      }
    }

    if (wasOpponentOwned) {
      const bonus = aggregateNumericEffect(mover, "flatRecaptureBonus", 0, (acc, b) => acc + b);
      if (bonus > 0) {
        mover.resources += bonus;
        result.recaptureBonus = bonus;
      }
    }

    if (hasEffect(mover, "claimOrthogonalNeighborsOnLanding")) {
      for (const { dr, dc } of ORTHOGONAL_OFFSETS) {
        const nr = dest.row + dr;
        const nc = dest.col + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        if (state.tiles[nr][nc].owner === opponentSide) continue;
        claimTile(state, side, nr, nc, false);
        result.neighborsClaimed.push({ row: nr, col: nc });
      }
    }

    return result;
  }

  function movesPerTurn(side, state) {
    const player = state.players[side];
    return aggregateNumericEffect(player, "extraMovesPerTurn", 1, (acc, m) => acc + m);
  }

  function computeUpgradeCost(side, key, state) {
    const player = state.players[side];
    const base = UPGRADE_CATALOG[key].baseCost;
    let discount = aggregateNumericEffect(player, "flatCostDiscount", 0, (acc, d) => acc + d);
    for (const learnedKey of learnedKeys(player)) {
      const turnScaled = UPGRADE_CATALOG[learnedKey].effects.turnScaledCostDiscount;
      if (turnScaled) discount += Math.floor(state.turn / turnScaled.divisor);
    }
    return Math.max(1, base - discount);
  }

  function getAffordableUpgrades(side, state) {
    const player = state.players[side];
    return Object.values(UPGRADE_CATALOG)
      .filter(
        (def) =>
          def.sides.includes(side) &&
          !player.upgrades[def.id] &&
          player.resources >= computeUpgradeCost(side, def.id, state)
      )
      .map((def) => def.id);
  }

  function learnUpgrade(side, key, state) {
    const player = state.players[side];
    const cost = computeUpgradeCost(side, key, state);
    player.resources -= cost;
    player.upgrades[key] = true;
    return cost;
  }

  function countOwnedTiles(state, side) {
    let count = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.tiles[r][c].owner === side) count++;
      }
    }
    return count;
  }

  function countTiles(state) {
    return { player: countOwnedTiles(state, "player"), cpu: countOwnedTiles(state, "cpu") };
  }

  function applyPassiveIncome(side, state) {
    const player = state.players[side];
    let income = 0;
    for (const key of learnedKeys(player)) {
      const effect = UPGRADE_CATALOG[key].effects.passiveIncomePerTurn;
      if (effect) income += Math.floor(countOwnedTiles(state, side) / effect.tilesPerResource);
    }
    player.resources += income;
    return income;
  }

  function advanceRegrowthQueue(state) {
    const stillPending = [];
    const regrown = [];
    for (const entry of state.regrowthQueue) {
      if (entry.dueTurn <= state.turn) {
        state.tiles[entry.row][entry.col].resource.harvested = false;
        regrown.push(entry);
      } else {
        stillPending.push(entry);
      }
    }
    state.regrowthQueue = stillPending;
    return regrown;
  }

  function getWinner(state) {
    const counts = countTiles(state);
    if (counts.player > counts.cpu) return "player";
    if (counts.cpu > counts.player) return "cpu";
    return "draw";
  }

  function chooseAiMove(legalMoves, side, state, rng) {
    const opponentSide = oppositeSide(side);
    const scored = legalMoves.map((move) => {
      const tile = state.tiles[move.row][move.col];
      let score;
      if (tile.resource.type === "rich" && !tile.resource.harvested) score = 30;
      else if (tile.resource.type === "normal" && !tile.resource.harvested) score = 15;
      else if (tile.owner === opponentSide) score = 8;
      else if (tile.owner === null) score = 3;
      else score = 0;
      return { move, score };
    });
    const maxScore = Math.max(...scored.map((s) => s.score));
    const top = scored.filter((s) => s.score === maxScore);
    const pick = top[Math.floor(rng() * top.length)];
    return pick.move;
  }

  function pickPriorityUpgrade(side, affordable) {
    const priorityList = side === "player" ? PLAYER_UPGRADE_PRIORITY : CPU_UPGRADE_PRIORITY;
    const found = priorityList.find((k) => affordable.includes(k));
    return found || affordable[0];
  }

  function decideTurnAction(side, state, rng) {
    const legalMoves = getLegalMoves(side, state);
    const affordable = getAffordableUpgrades(side, state);

    if (legalMoves.length === 0 && affordable.length === 0) {
      return { type: "pass" };
    }
    if (affordable.length === 0) {
      return { type: "move" };
    }
    if (legalMoves.length === 0) {
      return { type: "buy", upgradeKey: pickPriorityUpgrade(side, affordable) };
    }

    const priorityList = side === "player" ? PLAYER_UPGRADE_PRIORITY : CPU_UPGRADE_PRIORITY;
    const nextWanted = priorityList.find((k) => affordable.includes(k));
    if (nextWanted && state.turn <= LATE_TURN_CUTOFF && rng() < BUY_EAGERNESS) {
      return { type: "buy", upgradeKey: nextWanted };
    }
    return { type: "move" };
  }

  return {
    BOARD_SIZE,
    MAX_TURNS,
    MOVE_COST,
    STARTING_RESOURCES,
    UPGRADE_CATALOG,
    PLAYER_UPGRADE_PRIORITY,
    CPU_UPGRADE_PRIORITY,
    oppositeSide,
    learnedKeys,
    createInitialState,
    getLegalMoves,
    performMoveCycle,
    movesPerTurn,
    computeUpgradeCost,
    getAffordableUpgrades,
    learnUpgrade,
    countOwnedTiles,
    countTiles,
    applyPassiveIncome,
    advanceRegrowthQueue,
    getWinner,
    chooseAiMove,
    decideTurnAction,
  };
});
