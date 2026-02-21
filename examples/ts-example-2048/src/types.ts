export type Tile = {
  id: number,
  row: number,
  column: number,
  value: number,
  new?: boolean,
  merged?: boolean,
  deleted?: boolean
};

export type AppState = {
  tiles: Tile[],
  over: boolean,
  won: boolean,
  max: number,
  score: number,
  locked: boolean
};

export type Directions = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'

export type AppActions = {
  RESTART: null,
  MOVE: Directions,
  ADD_TILE: null
}

export type AppDrivers = {};

export type TileActions = {
  DELETE: null;
};

