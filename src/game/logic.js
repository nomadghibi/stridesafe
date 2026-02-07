export const directions = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function isOpposite(a, b) {
  return a.x + b.x === 0 && a.y + b.y === 0;
}

export function nextHead(head, dir) {
  return { x: head.x + dir.x, y: head.y + dir.y };
}

export function hasCollision(head, snake, gridSize) {
  if (head.x < 0 || head.y < 0 || head.x >= gridSize || head.y >= gridSize) {
    return true;
  }
  return snake.some((segment) => segment.x === head.x && segment.y === head.y);
}

export function placeFood(snake, gridSize, rng = Math.random) {
  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));
  const empty = [];
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const key = `${x},${y}`;
      if (!occupied.has(key)) {
        empty.push({ x, y });
      }
    }
  }
  if (empty.length === 0) {
    return null;
  }
  const index = Math.floor(rng() * empty.length);
  return empty[index];
}

export function createInitialState(gridSize, rng = Math.random) {
  const center = Math.floor(gridSize / 2);
  const snake = [
    { x: center + 1, y: center },
    { x: center, y: center },
    { x: center - 1, y: center },
  ];
  return {
    snake,
    direction: directions.right,
    food: placeFood(snake, gridSize, rng),
    score: 0,
    gameOver: false,
  };
}

export function step(state, inputDir, gridSize, rng = Math.random) {
  if (state.gameOver) {
    return state;
  }

  const direction = inputDir && !isOpposite(inputDir, state.direction) ? inputDir : state.direction;
  const head = state.snake[0];
  const newHead = nextHead(head, direction);

  const ateFood = state.food && newHead.x === state.food.x && newHead.y === state.food.y;
  const collisionBody = ateFood ? state.snake : state.snake.slice(0, -1);
  const collision = hasCollision(newHead, collisionBody, gridSize);
  if (collision) {
    return { ...state, gameOver: true };
  }

  const newSnake = [newHead, ...state.snake];
  if (!ateFood) {
    newSnake.pop();
  }

  const food = ateFood ? placeFood(newSnake, gridSize, rng) : state.food;
  return {
    snake: newSnake,
    direction,
    food,
    score: ateFood ? state.score + 1 : state.score,
    gameOver: false,
  };
}
