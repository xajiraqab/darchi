export namespace main {
	
	export class ArchiveFile {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    modTime: string;
	    icon: string;
	    duplicate: boolean;
	    onDesktop: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ArchiveFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.icon = source["icon"];
	        this.duplicate = source["duplicate"];
	        this.onDesktop = source["onDesktop"];
	    }
	}
	export class Archive {
	    name: string;
	    path: string;
	    created: string;
	    files: ArchiveFile[];
	
	    static createFrom(source: any = {}) {
	        return new Archive(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.created = source["created"];
	        this.files = this.convertValues(source["files"], ArchiveFile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class IconPos {
	    name: string;
	    x: number;
	    y: number;
	
	    static createFrom(source: any = {}) {
	        return new IconPos(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.x = source["x"];
	        this.y = source["y"];
	    }
	}
	export class Settings {
	    archiveRoot: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.archiveRoot = source["archiveRoot"];
	    }
	}

}

