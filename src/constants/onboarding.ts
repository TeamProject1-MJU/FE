export const onboardingButton = {
    background: '#89649F',
    pressed: '#75518F',
    foreground: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
} as const;

export const onboardingPages = [
    {
        label: '혼자 이동',
        title: '타기 전에 미리 보는\n경로와 혼잡도',
        description: '경로별 소요 시간과 예상 혼잡도를\n한눈에 확인해요.',
        background: '#EDE8F3',
        accent: '#5C3F78',
    },
    {
        label: 'AI 방향 안내',
        title: '방향이 헷갈리면\n표지판을 찍어보세요',
        description: '사진 한 장으로 내 경로와\n같은 방향인지 확인해요.',
        background: '#EDE8F3',
        accent: '#5C3F78',
    },
    {
        label: '함께 만나기',
        title: '모두에게 공평한\n중간역을 찾아드려요',
        description: '최대 4명의 출발역을 모아\n함께 만나기 좋은 역을 추천해요.',
        background: '#EDE8F3',
        accent: '#5C3F78',
    },
    {
        label: '약속방',
        title: '약속은 약속방에서\n한 번에 정리',
        description: '초대 코드로 친구와 모이고,\n채팅에서 @링크로에게 물어보세요.',
        background: '#EDE8F3',
        accent: '#5C3F78',
    },
] as const;
