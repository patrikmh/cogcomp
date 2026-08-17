DROP INDEX IF EXISTS conversation_turns_client_id_idx;

CREATE UNIQUE INDEX conversation_turns_client_id_idx
    ON conversation_turns (conversation_id, user_id, client_turn_id, speaker)
    WHERE client_turn_id IS NOT NULL;
