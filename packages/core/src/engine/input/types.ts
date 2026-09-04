export interface HumanParticipant {
  name: string;
  /** 真人成员卡，供 Agent 理解此人，但不能用于代替真人发言。 */
  card?: string;
}

export interface HumanMessageInput {
  participantName: string;
  message: string;
}
