"use strict";

const Rules = require("./rules.js");

function runAiTurn(side, state, rng) {
  Rules.applyPassiveIncome(side, state);
  const decision = Rules.decideTurnAction(side, state, rng);

  if (decision.type === "buy") {
    Rules.learnUpgrade(side, decision.upgradeKey, state);
    return;
  }
  if (decision.type === "move") {
    let movesLeft = Rules.movesPerTurn(side, state);
    while (movesLeft > 0) {
      const legal = Rules.getLegalMoves(side, state);
      if (legal.length === 0) break;
      const dest = Rules.chooseAiMove(legal, side, state, rng);
      Rules.performMoveCycle(side, dest, state);
      movesLeft--;
    }
  }
  // decision.type === "pass": nothing to do
}

function playOneGame(rng) {
  const state = Rules.createInitialState();
  while (state.turn <= Rules.MAX_TURNS) {
    runAiTurn("player", state, rng);
    runAiTurn("cpu", state, rng);
    state.turn += 1;
  }
  const counts = Rules.countTiles(state);
  return { winner: Rules.getWinner(state), playerTiles: counts.player, cpuTiles: counts.cpu };
}

function runBatch(n) {
  let playerWins = 0;
  let cpuWins = 0;
  let draws = 0;
  let marginSum = 0;
  let marginAbsSum = 0;

  for (let i = 0; i < n; i++) {
    const result = playOneGame(Math.random);
    if (result.winner === "player") playerWins++;
    else if (result.winner === "cpu") cpuWins++;
    else draws++;

    const margin = result.playerTiles - result.cpuTiles;
    marginSum += margin;
    marginAbsSum += Math.abs(margin);
  }

  return {
    n,
    playerWins,
    cpuWins,
    draws,
    avgMargin: marginSum / n,
    avgAbsMargin: marginAbsSum / n,
  };
}

function printCostTable() {
  console.log("現在の強化コスト:");
  for (const def of Object.values(Rules.UPGRADE_CATALOG)) {
    console.log(`  ${def.id.padEnd(16)} ${def.name.padEnd(12)} sides=${def.sides.join(",").padEnd(11)} cost=${def.baseCost}`);
  }
  console.log("");
}

function printSummary(stats) {
  const pct = (count) => ((count / stats.n) * 100).toFixed(1);
  console.log(`Simulating ${stats.n} games...`);
  console.log(`Player (うさぎ) wins: ${stats.playerWins} (${pct(stats.playerWins)}%)`);
  console.log(`CPU (シマエナガ) wins: ${stats.cpuWins} (${pct(stats.cpuWins)}%)`);
  console.log(`Draws: ${stats.draws} (${pct(stats.draws)}%)`);
  console.log(`Average tile margin (player - cpu): ${stats.avgMargin.toFixed(2)}`);
  console.log(`Average |margin|: ${stats.avgAbsMargin.toFixed(2)}`);
}

const n = Number(process.argv[2]) || 1000;
printCostTable();
const stats = runBatch(n);
printSummary(stats);
