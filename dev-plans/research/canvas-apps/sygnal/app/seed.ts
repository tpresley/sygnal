/** the sample page the app opens with */
import {make, type Shape} from './doc'

export function seed(): Shape[] {
  return [
    make('frame', 'f1', 1, {x: 80, y: 80, width: 480, height: 320, name: 'Card'}),
    make('rect', 'r1', 1, {x: 112, y: 112, width: 160, height: 120, radius: 12, fill: '#0d99ff'}, 'f1'),
    make('ellipse', 'e1', 1, {x: 312, y: 128, width: 96, height: 96, fill: '#ffc700'}, 'f1'),
    make('text', 't1', 1, {x: 112, y: 280, text: 'Hello, canvas', fontSize: 28}, 'f1'),
    make('rect', 'r2', 2, {x: 640, y: 120, width: 140, height: 140, fill: '#14ae5c', rotation: 15}),
    make('ellipse', 'e2', 2, {x: 660, y: 320, width: 180, height: 90, fill: '#f24822', stroke: '#000000', strokeWidth: 2}),
  ]
}
