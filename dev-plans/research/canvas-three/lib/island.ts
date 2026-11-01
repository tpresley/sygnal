/** the instance of the widget mounted on a host element (tests, devtools): defineWidget keeps it on `__sw` */
export const islandOf = (el: any): any => el?.__sw?.i
