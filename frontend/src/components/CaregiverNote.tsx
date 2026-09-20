import type { CallParticipants } from '../types/contract';

interface Props {
  participants?: CallParticipants;
}

/**
 * Whose account this is.
 *
 * A medication list given by a participant's daughter is not worse evidence —
 * she is very often the one who fills the pill organiser and the more reliable
 * source. But it is *different* evidence, and a coordinator reading the log
 * six weeks later cannot tell from the rows alone. So the screen says it.
 *
 * The relationship appears; the name does not. A caregiver has no more place
 * being named in the clinical record than the participant does.
 */
export function CaregiverNote({ participants }: Props) {
  if (!participants?.caregiverPresent) return null;

  const { caregiverRelationship, caregiverAuthStatus } = participants;
  const who = caregiverRelationship ? `the participant's ${caregiverRelationship}` : 'a caregiver';

  // An unauthorised person on the call is a finding in itself: the agent
  // should have stopped, and the coordinator needs to know whether it did.
  if (caregiverAuthStatus !== 'authorised') {
    return (
      <p className="callnote" data-tone="attention" role="note">
        <strong>Caregiver not authorised.</strong> Someone identifying as {who} joined this
        call and could not be matched to the authorisation list. Nothing about the participant
        should have been discussed after that point — check the transcript before relying on
        anything below.
      </p>
    );
  }

  return (
    <p className="callnote" role="note">
      <strong>Caregiver-assisted call.</strong> Answers were given with help from {who}, who is
      on the participant's authorisation list.
    </p>
  );
}
