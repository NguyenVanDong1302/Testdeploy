// src/pages/Home/mock.ts
export type StoryItem = {
    id: string
    type: 'image' | 'video'
    src: string
    durationMs?: number // default 15000
}

export type Story = {
    id: string
    name: string
    avatar: string
    timeLabel: string // "4 giờ", "19 giờ", ...
    items: StoryItem[]
}

export const stories: Story[] = [
    {
        id: 's1',
        name: 'thorph124',
        avatar: 'https://i.pravatar.cc/80?img=32',
        timeLabel: '4 giờ',
        items: [
            {
                id: 's1-1',
                type: 'image',
                src: 'https://scontent.fhan14-3.fna.fbcdn.net/v/t39.30808-6/640913316_1664882744889736_1627784477976971_n.jpg?stp=dst-jpg_s590x590_tt6&_nc_cat=110&ccb=1-7&_nc_sid=7b2446&_nc_eui2=AeHTDynvYcFqNOlhCPafmvyTtWC-K7htpJ61YL4ruG2knmfRE8urGMoMl_JKk3kZdGjR7wtC6klNwmMTvMfl_MXQ&_nc_ohc=CP165okJOjcQ7kNvwHgnCyO&_nc_oc=AdmqrYhbBaxqnRjIX9oxR6nroP9FTap9ia71aIfH1lk5eSH_A8uLGaEFvPPFwODe3NcwQx1L1Gk3bURm_W-4SHZO&_nc_zt=23&_nc_ht=scontent.fhan14-3.fna&_nc_gid=9NGU1V87QtxN1QPggFS1kw&_nc_ss=8&oh=00_AfxEiP8SYAnKim4-GXPdCIu3QzxkU2KSxp8PkLuZ72XmCQ&oe=69ACABA7',
                durationMs: 15000,
            },
        ],
    },
    {
        id: 's2',
        name: 'meosleep_8.7',
        avatar: 'https://i.pravatar.cc/80?img=12',
        timeLabel: '4 giờ',
        items: [
            {
                id: 's2-1',
                type: 'image',
                src: 'https://i.pinimg.com/736x/85/5e/62/855e62e94722762abbf402061438ecb5.jpg',
                durationMs: 15000,
            },
            {
                id: 's2-2',
                type: 'image',
                src: 'https://i.pinimg.com/736x/f5/ea/04/f5ea04d8059c9653e25d9a1196670b8e.jpg',
                durationMs: 15000,
            },
        ],
    },
    {
        id: 's3',
        name: 'hw.wyz_',
        avatar: 'https://i.pravatar.cc/80?img=47',
        timeLabel: '19 giờ',
        items: [
            {
                id: 's3-1',
                type: 'image',
                src: 'https://i.pinimg.com/736x/85/75/12/857512871ec53ced9ba01ce10da96a5b.jpg',
                durationMs: 15000,
            },
        ],
    },
]

export const suggestions = [
    { id: 'u1', name: 'chipmunk.8767254', sub: 'Gợi ý cho bạn', avatar: 'https://i.pravatar.cc/80?img=5' },
    { id: 'u2', name: 'ntran1_', sub: 'Gợi ý cho bạn', avatar: 'https://i.pravatar.cc/80?img=7' },
    { id: 'u3', name: 'gnaoh.oac', sub: 'Gợi ý cho bạn', avatar: 'https://i.pravatar.cc/80?img=22' },
    { id: 'u4', name: 'sii37414', sub: 'Theo dõi bạn', avatar: 'https://i.pravatar.cc/80?img=25' },
    { id: 'u5', name: 'Bannie Bannie', sub: 'Có _melia_aa + 1 người n', avatar: 'https://i.pravatar.cc/80?img=28' },
]