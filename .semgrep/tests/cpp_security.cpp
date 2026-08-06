void unsafe_copy(char *destination, const char *source) {
  // ruleid: quantnexus.cpp.unsafe-unbounded-c-string-api
  strcpy(destination, source);
}

void bounded_copy(char *destination, const char *source, unsigned long size) {
  // ok: quantnexus.cpp.unsafe-unbounded-c-string-api
  snprintf(destination, size, "%s", source);
}

void launch_shell(const char *command) {
  // ruleid: quantnexus.cpp.shell-command-execution
  system(command);
}
