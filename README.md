# 🚇 LinkRo Frontend

LinkRo의 Frontend Repository입니다.

React Native와 TypeScript를 기반으로  
지하철 경로 탐색, 중간역 추천, 혼잡도 확인, AI 노선 방향 안내, 약속방 등의 사용자 화면을 구현합니다.

---

## 🛠 Tech Stack

### Frontend

![React Native](https://img.shields.io/badge/React_Native-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-000020?style=flat-square&logo=expo&logoColor=white)

### Collaboration

![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)
![Figma](https://img.shields.io/badge/Figma-F24E1E?style=flat-square&logo=figma&logoColor=white)

---

## ✨ 주요 화면 및 기능

- 홈 화면
- 경로 탐색 화면
- 향후 시간대별 혼잡도 확인
- AI 중간역 추천
- 표지판 이미지 기반 노선 방향 안내
- 약속방 및 이동 상태 확인

---

## 📁 Project Structure

```text
src/
├── app/            # 화면 및 라우팅
├── components/     # 공통 컴포넌트
├── constants/      # 상수
├── hooks/          # Custom Hooks
└── assets/         # 이미지 및 리소스
```

> 프로젝트 진행에 따라 폴더 구조는 변경될 수 있습니다.

---

## 🚀 Getting Started

### 1. Repository Clone

```bash
git clone https://github.com/TeamProject1-MJU/FE.git
```

### 2. 프로젝트 폴더 이동

```bash
cd FE
```

### 3. 패키지 설치

```bash
npm install
```

### 4. 프로젝트 실행

```bash
npm start
```

또는

```bash
npx expo start
```

---

## 🌐 실행 방법

Expo 개발 서버 실행 후 원하는 환경에서 확인할 수 있습니다.

```text
w → Web
a → Android
```

모바일에서는 Expo Go를 통해 QR 코드를 스캔하여 실행할 수 있습니다.

---

## 🔀 Branch Strategy

```text
main
 └── dev
      ├── feat/*
      ├── fix/*
      └── chore/*
```

- `main` : 최종 안정 버전
- `dev` : 개발 통합 브랜치
- `feat/*` : 기능 개발
- `fix/*` : 버그 수정
- `chore/*` : 설정 및 기타 작업

---

## 📝 Development Process

```text
Issue 생성
   ↓
작업 Branch 생성
   ↓
기능 구현
   ↓
Commit & Push
   ↓
Pull Request
   ↓
Code Review
   ↓
dev Merge
   ↓
작업 Branch 삭제
```

PR 본문에 아래와 같이 관련 이슈를 연결합니다.

```text
Closes #이슈번호
```

PR이 Merge되면 연결된 Issue가 자동으로 종료됩니다.

---

## 💬 Commit Convention

| Type | 설명 |
| --- | --- |
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `chore` | 환경 설정 및 기타 작업 |
| `refactor` | 코드 리팩토링 |
| `docs` | 문서 수정 |
| `style` | UI 및 스타일 수정 |

예시:

```text
feat: 홈 화면 UI 구현 (#2)
```

```text
chore: Expo 초기 개발 환경 설정 (#1)
```

---

## 👥 Frontend Team

| 이름 | 역할 | GitHub |
| --- | --- | --- |
| 최인준 | Full-Stack · Team Leader | [cij041109-del](https://github.com/cij041109-del) |
| 최가율 | Frontend | [choigayul](https://github.com/choigayul) |
| 손창범 | Frontend · AI | [sonchang321](https://github.com/sonchang321) |

---

## 🔗 Related Repository

### Backend

[TeamProject1-MJU/BE](https://github.com/TeamProject1-MJU/BE)

---

<div align="center">

### Link your route, LinkRo 🚇

**지하철 이동의 여러 순간을 하나의 흐름으로 연결합니다.**

</div>chat.expo.dev): Chat with Expo users and ask questions.
