type StyleMap = Record<string, string>

export function combineResponsiveStyles(...styleMaps: StyleMap[]) {
  return new Proxy({} as StyleMap, {
    get(_, property: string | symbol) {
      if (typeof property !== 'string') return ''
      return styleMaps
        .map((styleMap) => styleMap?.[property])
        .filter(Boolean)
        .join(' ')
    },
  })
}
