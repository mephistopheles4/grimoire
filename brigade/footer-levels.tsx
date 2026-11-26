import type { ClientModule } from 'claude-code'

// The footer popover's rows, one per level. A left press on a row posts its
// level to register.tsx, which decides what the press may do.
type P = { level: number; names: string[] }

const FooterLevels: ClientModule<P, number | undefined> = (props, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    const row = Math.floor(e.y)
    if (e.type === 'move' || e.type === 'enter') surface.setState(row)
    if (e.type === 'leave') surface.setState(undefined)
    if (e.type === 'down' && e.button === 'left' && row >= 0 && row < props.names.length) surface.post({ pick: row + 1 })
  })
  return Box({
    flexDirection: 'column',
    children: props.names.map((name, i) =>
      Text({
        bold: i + 1 === props.level,
        inverse: surface.state === i,
        children: `${i + 1 === props.level ? '✓' : ' '} ${name}  `,
      }),
    ),
  })
}

export default FooterLevels
