#[cfg(target_os = "windows")]
pub mod win_job {
    use std::os::raw::c_void;

    #[repr(C)]
    #[allow(non_camel_case_types)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        active_process_limit: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit_flags: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[allow(non_camel_case_types)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: [u8; 48],
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_limit: usize,
        peak_job_memory_limit: usize,
    }

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x00002000;
    const JOB_OBJECT_LIMIT_PROCESS_MEMORY: u32 = 0x00000100;
    const JOB_OBJECT_LIMIT_JOB_MEMORY: u32 = 0x00000200;
    const JOB_OBJECT_LIMIT_PRIORITY_CLASS: u32 = 0x00000020;
    const JOB_OBJECT_LIMIT_ACTIVE_PROCESS: u32 = 0x00000008;

    const JOB_OBJECT_INFO_CLASS_EXTENDED_LIMIT_INFORMATION: i32 = 9;

    extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *mut c_void, lpName: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            hJob: *mut c_void,
            JobObjectInformationClass: i32,
            lpJobObjectInformation: *const c_void,
            cbJobObjectInformationLength: u32,
        ) -> i32;
        fn AssignProcessToJobObject(hJob: *mut c_void, hProcess: *mut c_void) -> i32;
        fn CloseHandle(hObject: *mut c_void) -> i32;
    }

    pub struct JobObject {
        handle: *mut c_void,
    }

    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn new() -> Result<Self, String> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err("Failed to create Job Object".to_string());
            }

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    active_process_limit: 0,
                    minimum_working_set_size: 0,
                    maximum_working_set_size: 0,
                    active_process_limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    affinity: 0,
                    priority_class: 0,
                    scheduling_class: 0,
                },
                io_info: [0u8; 48],
                process_memory_limit: 0,
                job_memory_limit: 0,
                peak_process_memory_limit: 0,
                peak_job_memory_limit: 0,
            };

            let success = unsafe {
                SetInformationJobObject(
                    handle,
                    JOB_OBJECT_INFO_CLASS_EXTENDED_LIMIT_INFORMATION,
                    &mut info as *mut _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };

            if success == 0 {
                unsafe { CloseHandle(handle) };
                return Err("Failed to set Job Object limits".to_string());
            }

            Ok(JobObject { handle })
        }

        pub fn new_with_limits(
            memory_limit_bytes: usize,
            process_limit: u32,
        ) -> Result<Self, String> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err("Failed to create Job Object with limits".to_string());
            }

            let mut flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PRIORITY_CLASS;

            let mut process_memory_limit = 0;
            let mut job_memory_limit = 0;
            if memory_limit_bytes > 0 {
                flags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY;
                process_memory_limit = memory_limit_bytes;
                job_memory_limit = memory_limit_bytes;
            }

            let mut active_process_limit = 0;
            if process_limit > 0 {
                flags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
                active_process_limit = process_limit;
            }

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    active_process_limit,
                    minimum_working_set_size: 0,
                    maximum_working_set_size: 0,
                    active_process_limit_flags: flags,
                    affinity: 0,
                    priority_class: 0x00004000, // BELOW_NORMAL_PRIORITY_CLASS
                    scheduling_class: 0,
                },
                io_info: [0u8; 48],
                process_memory_limit,
                job_memory_limit,
                peak_process_memory_limit: 0,
                peak_job_memory_limit: 0,
            };

            let success = unsafe {
                SetInformationJobObject(
                    handle,
                    JOB_OBJECT_INFO_CLASS_EXTENDED_LIMIT_INFORMATION,
                    &mut info as *mut _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };

            if success == 0 {
                unsafe { CloseHandle(handle) };
                return Err("Failed to set Job Object limits".to_string());
            }

            Ok(JobObject { handle })
        }

        #[allow(clippy::not_unsafe_ptr_arg_deref)]
        pub fn assign_process(&self, process_handle: *mut c_void) -> Result<(), String> {
            let success = unsafe { AssignProcessToJobObject(self.handle, process_handle) };
            if success == 0 {
                return Err("Failed to assign process to Job Object".to_string());
            }
            Ok(())
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub use win_job::JobObject;

#[cfg(not(target_os = "windows"))]
pub struct JobObject;

#[cfg(not(target_os = "windows"))]
impl JobObject {
    pub fn new() -> Result<Self, String> {
        Ok(JobObject)
    }
    pub fn new_with_limits(
        _memory_limit_bytes: usize,
        _process_limit: u32,
    ) -> Result<Self, String> {
        Ok(JobObject)
    }
    pub fn assign_process(&self, _process_handle: *mut std::ffi::c_void) -> Result<(), String> {
        Ok(())
    }
}
