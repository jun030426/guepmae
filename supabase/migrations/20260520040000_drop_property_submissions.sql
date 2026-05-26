/*
 * property_submissions 테이블 제거.
 *
 * 옛 "내 매물 검증 계산기" (/register) 의 제출 내역 저장용이었으나
 * 비즈니스 방향이 "중개사만 매물 등록" 으로 정리되면서 미사용.
 * 관련 코드(RegisterProperty.jsx, propertySubmissions.js) 함께 제거됨.
 */

drop table if exists public.property_submissions cascade;
