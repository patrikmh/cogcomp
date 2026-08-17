ALTER TABLE conversation_turns
    ADD COLUMN client_turn_id UUID;

CREATE UNIQUE INDEX conversation_turns_client_id_idx
    ON conversation_turns (conversation_id, user_id, client_turn_id)
    WHERE client_turn_id IS NOT NULL;
