if(NOT DEFINED EXECUTABLE OR NOT DEFINED ARGUMENT OR NOT DEFINED EXPECTED)
    message(FATAL_ERROR "EXECUTABLE, ARGUMENT, and EXPECTED are required")
endif()

execute_process(
    COMMAND "${EXECUTABLE}" "${ARGUMENT}"
    RESULT_VARIABLE result
    OUTPUT_VARIABLE standard_output
    ERROR_VARIABLE standard_error)

if(result EQUAL 0)
    message(FATAL_ERROR "command unexpectedly succeeded")
endif()

string(FIND "${standard_output}${standard_error}" "${EXPECTED}" match_offset)
if(match_offset EQUAL -1)
    message(FATAL_ERROR
        "rejection did not contain ${EXPECTED}: ${standard_output}${standard_error}")
endif()
