def rejected_candidates(candidates):
    for candidate in candidates:
        # ruleid: quantnexus.python.no-silent-factor-mining-candidate-failure
        try:
            candidate.execute()
        except Exception:
            continue


def observable_rejection(candidate, report):
    # ok: quantnexus.python.no-silent-factor-mining-candidate-failure
    try:
        return candidate.execute()
    except Exception as error:
        report(error)
        return None
